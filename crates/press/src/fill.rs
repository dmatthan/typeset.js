//! Column filling: a section's paragraphs, broken into lines, poured into columns of
//! a fixed number of rows. All vertical space is whole rows, so every column bottom
//! lines up.

use crate::brk::{Shape, break_lines};
use crate::hyph::Patterns;
use crate::shape::{Measurer, Mono, Typo};
use typeset_model::js::U16Cursor;
use typeset_model::{Image, Kind, Section, style};

#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// Size, weights, spacing and axes.
    pub typo: Typo,
    /// Column width in px.
    pub measure: f32,
    /// Rows per column.
    pub rows: u32,
    /// Rows the chapter head takes at the top of a chapter's first column.
    pub head_rows: u32,
    /// Height of a row in px (images are fitted to whole rows).
    pub lh: f32,
    /// The renderer shapes each inline element on its own, so kerning does not cross a
    /// link's edge (WebKit; Chromium shapes across). Calibration finds out.
    pub link_runs: bool,
    pub justify: bool,
    pub hyphenate: bool,
}

pub mod flag {
    pub const JUSTIFY: u16 = 1;
    pub const HYPH: u16 = 2;
    pub const RIGHT: u16 = 4;
    pub const CENTER: u16 = 8;
    pub const HEAD: u16 = 16;
    pub const VERSE: u16 = 32;
    pub const QUOTE: u16 = 64;
    pub const BREAK: u16 = 128;
    /// First line of its block.
    pub const FIRST: u16 = 256;
    /// Draw a bullet in the hang of this line.
    pub const BULLET: u16 = 512;
    /// An image: `x`, `avail` and `natural` are its left, width and height in px, and
    /// `spaces` the rows it spans; the rows after it are `IMAGE_ROW` lines.
    pub const IMAGE: u16 = 1024;
    pub const IMAGE_ROW: u16 = 2048;
    /// A line of a table cell (set ragged at `x` within the cell's width).
    pub const CELL: u16 = 4096;
    /// On the same grid row as the line before it (the cells of a table row).
    pub const SAME_ROW: u16 = 8192;
    /// A table's rule: a hairline across `avail` at the top of its row.
    pub const RULE: u16 = 16384;
    /// Set at its own size, in `spaces` (sixteenths of a px) instead of a count of spaces:
    /// preformatted text (in the monospaced face), and the cells of a table set smaller to
    /// fit the measure.
    pub const SIZED: u16 = 32768;
}

/// One set line, positioned on the column grid.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PLine {
    pub col: u32,
    pub row: u32,
    /// Block index within the section.
    pub block: u32,
    /// UTF-16 range in the block text.
    pub s: u32,
    pub e: u32,
    /// Left offset and available width, px.
    pub x: f32,
    pub avail: f32,
    pub natural: f32,
    pub spaces: u16,
    pub flags: u16,
}

#[derive(Clone, Debug, Default)]
pub struct SectionLayout {
    pub cols: u32,
    pub lines: Vec<PLine>,
    /// The rows the chapter's head takes at the top of its first column (none for front
    /// matter): the text begins on the row after it.
    pub head_rows: u32,
}

/// Paragraph-level result before filling: lines plus the rules for placing them.
pub(crate) struct Para {
    pub(crate) lines: Vec<PLine>,
    pub(crate) space_before: u32,
    pub(crate) space_after: u32,
    pub(crate) keep_with_next: bool,
    /// Never split (breaks, short verse lines).
    pub(crate) whole: bool,
}

const EM_INDENT: f32 = 1.3;
const EM_QUOTE: f32 = 1.4;
const EM_VERSE: f32 = 1.2;
const EM_VERSE_HANG: f32 = 1.3;

/// A block's style spans, with `add` styles. When the renderer shapes each inline element
/// on its own (`Params::link_runs`: WebKit), spans are also cut at link edges, so text on
/// either side is measured apart, as it will be drawn (no kerning across the edge).
pub(crate) fn spans_with(b: &typeset_model::Block, add: u8, link_runs: bool) -> Vec<(usize, usize, u8)> {
    let mut out: Vec<(usize, usize, u8)> = b.spans().map(|(s, e, st)| (s, e, st | add)).collect();
    if link_runs && !b.links.is_empty() {
        let mut cuts: Vec<usize> = b.links.iter().flat_map(|l| [l.start as usize, l.end as usize]).collect();
        cuts.sort_unstable();
        cuts.dedup();
        let mut split = Vec::with_capacity(out.len() + cuts.len());
        for (s, e, st) in out {
            let mut a = s;
            for &c in cuts.iter().filter(|&&c| c > s && c < e) {
                split.push((a, c, st));
                a = c;
            }
            split.push((a, e, st));
        }
        out = split;
    }
    out
}

/// Sets one section's paragraphs into lines (no columns yet).
fn set_paras(m: &mut Measurer, mono: &mut Mono, sec: &Section, images: &[Image], p: &Params, lang: Option<&Patterns>) -> Vec<Para> {
    let em = p.typo.size;
    let mut out: Vec<Para> = Vec::with_capacity(sec.blocks.len());
    let mut no_indent = true;
    for (bi, b) in sec.blocks.iter().enumerate() {
        let bi = bi as u32;
        let mut para = Para { lines: Vec::new(), space_before: 0, space_after: 0, keep_with_next: false, whole: false };
        let mk = |lines: Vec<crate::brk::Line>, text: &str, base: usize, x_first: f32, x_rest: f32, flags: u16, out: &mut Vec<PLine>| {
            let mut cur = U16Cursor::new(text);
            for (i, l) in lines.iter().enumerate() {
                let x = if i == 0 { x_first } else { x_rest };
                let mut f = flags;
                if l.justify {
                    f |= flag::JUSTIFY;
                }
                if l.hyph {
                    f |= flag::HYPH;
                }
                if i == 0 && base == 0 {
                    f |= flag::FIRST;
                } else {
                    f &= !flag::BULLET;
                }
                let s = cur.at(base + l.s as usize);
                let e = cur.at(base + l.e as usize);
                out.push(PLine { col: 0, row: 0, block: bi, s, e, x, avail: p.measure - x, natural: l.natural, spaces: l.spaces, flags: f });
            }
        };
        match b.kind {
            Kind::Pre => {
                // the largest size, up to 0.82 of the text's, at which the longest line fits
                // the measure (the face's advance is 0.6 em); below 0.55, lines wrap instead
                let longest = b.text.split('\n').map(|l| l.chars().count()).max().unwrap_or(1).max(1) as f32;
                let fit = p.measure / (longest * 0.6) * 0.99;
                let size = (((em * 0.82).min(fit) * 4.0).floor() / 4.0).max((em * 0.55 * 4.0).ceil() / 4.0);
                let wide = |t: &str, mono: &mut Mono, m: &mut Measurer| mono.width(size, p.typo.round, p.typo.app_units, t).unwrap_or_else(|| m.width(t, 0) * size / em);
                let mut cur = U16Cursor::new(&b.text);
                let mut at = 0usize;
                // a line still too wide wraps at its last space that fits (or, with none,
                // where it must), and goes on hung two characters in
                let hang = mono.width(size, p.typo.round, p.typo.app_units, "  ").unwrap_or(size * 1.2);
                for line in b.text.split('\n') {
                    let mut start = at;
                    let end = at + line.len();
                    let mut x = 0.0;
                    loop {
                        let room = p.measure - x;
                        // the longest piece from `start` that fits, counted in characters: a
                        // piece only widens as it grows, so its length is searched for from
                        // the face's advance, outward and then by halves (a line many times the
                        // measure costs a few measurements, not one per character)
                        let rest = &b.text[start..end];
                        let chars = rest.chars().count();
                        let end_of = |n: usize| rest.char_indices().nth(n).map_or(end, |(i, _)| start + i);
                        let fits = |n: usize, mono: &mut Mono, m: &mut Measurer| wide(&b.text[start..end_of(n)], mono, m) <= room;
                        // `lo` characters fit, `hi` do not
                        let (mut lo, mut hi) = (0, chars + 1);
                        let mut step = 1;
                        let guess = ((room / (size * 0.6)) as usize).clamp(1, chars.max(1));
                        if fits(guess, mono, m) {
                            lo = guess;
                            while lo < chars {
                                let n = (lo + step).min(chars);
                                if !fits(n, mono, m) {
                                    hi = n;
                                    break;
                                }
                                lo = n;
                                step *= 2;
                            }
                        } else {
                            hi = guess;
                            while hi > step {
                                let n = hi - step;
                                if fits(n, mono, m) {
                                    lo = n;
                                    break;
                                }
                                hi = n;
                                step *= 2;
                            }
                        }
                        while lo + 1 < hi {
                            let mid = (lo + hi) / 2;
                            if fits(mid, mono, m) {
                                lo = mid;
                            } else {
                                hi = mid;
                            }
                        }
                        let mut stop = end_of(lo);
                        if stop == start {
                            stop = end.min(start + b.text[start..].chars().next().map(char::len_utf8).unwrap_or(0));
                        }
                        let mut next = stop;
                        if stop < end {
                            if let Some(sp) = b.text[start..=stop].rfind(' ').map(|i| start + i).filter(|&i| !b.text[start..i].trim_start().is_empty()) {
                                stop = b.text[start..sp].trim_end_matches(' ').len() + start;
                                next = sp;
                            }
                            next += b.text[next..end].len() - b.text[next..end].trim_start_matches(' ').len();
                        }
                        let w = if stop > start { wide(&b.text[start..stop], mono, m) } else { 0.0 };
                        let f = if start == 0 { flag::SIZED | flag::FIRST } else { flag::SIZED };
                        para.lines.push(PLine { col: 0, row: 0, block: bi, s: cur.at(start), e: cur.at(stop), x, avail: room, natural: w, spaces: (size * 16.0) as u16, flags: f });
                        if next >= end {
                            break;
                        }
                        start = next;
                        x = hang;
                    }
                    at = end + 1;
                }
                para.whole = true;
                para.space_before = 1;
                para.space_after = 1;
                no_indent = true;
            }
            Kind::Table => {
                let mut rows = crate::table::set_table(m, b, bi, p, lang);
                if let Some(first) = rows.first_mut() {
                    first.space_before = 1;
                }
                if let Some(last) = rows.last_mut() {
                    last.space_after = 1;
                }
                out.extend(rows);
                no_indent = true;
                continue;
            }
            Kind::Image => {
                // fitted to the measure and to a column, rounded up to whole rows, centred
                let rows = p.rows.max(4);
                let (iw, ih) = b.image.and_then(|i| images.get(i as usize)).filter(|i| i.w > 0 && i.h > 0).map(|i| (i.w as f32, i.h as f32)).unwrap_or((p.measure, p.measure * 0.6));
                let mut w = iw.min(p.measure);
                let mut h = w * ih / iw;
                let max_h = (rows - 1) as f32 * p.lh;
                if h > max_h {
                    h = max_h;
                    w = h * iw / ih;
                }
                let span = ((h / p.lh).ceil() as u32).clamp(1, rows - 1);
                para.lines.push(PLine { col: 0, row: 0, block: bi, s: 0, e: 0, x: ((p.measure - w) / 2.0).max(0.0), avail: w, natural: h, spaces: span as u16, flags: flag::IMAGE | flag::FIRST });
                for _ in 1..span {
                    para.lines.push(PLine { col: 0, row: 0, block: bi, s: 0, e: 0, x: 0.0, avail: p.measure, natural: 0.0, spaces: 0, flags: flag::IMAGE_ROW });
                }
                para.whole = true;
                para.space_before = 1;
                para.space_after = 1;
                no_indent = true;
            }
            // two rows: the reader's mark on the first, or the rule its book draws between them
            // (at its width and place, drawn as a table's rule is, at the second's top)
            Kind::Break => {
                let line = |x: f32, avail: f32, flags: u16| PLine { col: 0, row: 0, block: bi, s: 0, e: 0, x, avail, natural: 0.0, spaces: 0, flags };
                match b.rule {
                    Some(r) => {
                        let w = (r.width * p.measure).round();
                        let x = match r.align {
                            1 => ((p.measure - w) / 2.0).round(),
                            2 => p.measure - w,
                            _ => 0.0,
                        };
                        para.lines.push(line(0.0, p.measure, flag::BREAK));
                        para.lines.push(line(x, w, flag::RULE));
                    }
                    None => {
                        para.lines.push(line(0.0, p.measure, flag::BREAK | flag::CENTER | flag::FIRST));
                        para.lines.push(line(0.0, p.measure, flag::BREAK));
                    }
                }
                para.whole = true;
                no_indent = true;
            }
            Kind::Verse => {
                let (x1, x2) = (EM_VERSE * em, (EM_VERSE + EM_VERSE_HANG) * em);
                let sh = Shape { first: p.measure - x1, rest: p.measure - x2, justify: false, hyphenate: false };
                let spans = spans_with(b, 0, p.link_runs);
                let mut base = 0usize;
                for line in b.text.split('\n') {
                    let local: Vec<(usize, usize, u8)> = spans
                        .iter()
                        .filter(|&&(s, e, _)| e > base && s < base + line.len())
                        .map(|&(s, e, st)| (s.max(base) - base, e.min(base + line.len()) - base, st))
                        .collect();
                    let lines = break_lines(m, line, &local, &sh, None);
                    mk(lines, &b.text, base, x1, x2, flag::VERSE, &mut para.lines);
                    base += line.len() + 1;
                }
                // every verse line counts as the start of its block for indenting purposes
                para.space_before = 1;
                para.space_after = 1;
                no_indent = true;
            }
            Kind::H => {
                let sh = Shape { first: p.measure, rest: p.measure, justify: false, hyphenate: false };
                let lines = break_lines(m, &b.text, &spans_with(b, style::BOLD, p.link_runs), &sh, None);
                mk(lines, &b.text, 0, 0.0, 0.0, flag::HEAD, &mut para.lines);
                para.space_before = 1;
                para.keep_with_next = true;
                no_indent = true;
            }
            Kind::Attrib | Kind::Sign | Kind::Center => {
                let (add, f) = match b.kind {
                    Kind::Attrib => (0, flag::RIGHT),
                    Kind::Sign => (style::SMALLCAPS, flag::RIGHT),
                    // (centred as the publisher centred it; italic only where its text is)
                    _ => (0, flag::CENTER),
                };
                let sh = Shape { first: p.measure, rest: p.measure, justify: false, hyphenate: false };
                let lines = break_lines(m, &b.text, &spans_with(b, add, p.link_runs), &sh, None);
                mk(lines, &b.text, 0, 0.0, 0.0, f, &mut para.lines);
                if b.kind == Kind::Center {
                    para.space_before = 1;
                    para.space_after = 1;
                }
                no_indent = true;
            }
            Kind::P | Kind::Q | Kind::Li => {
                // (a paragraph its book sets ragged apart from a justified text stays so)
                let justify = p.justify && !b.set.is_some_and(|s| s.ragged);
                let (x1, x2, f) = match (b.kind, b.set) {
                    (Kind::Q, _) => (EM_QUOTE * em, EM_QUOTE * em, flag::QUOTE),
                    (Kind::Li, _) => (EM_INDENT * em, EM_INDENT * em, flag::BULLET),
                    // a paragraph as its book sets it: its indent, and its space above in
                    // whole rows (half a row or more is one)
                    (_, Some(s)) => {
                        para.space_before = para.space_before.max((s.above * em / p.lh).round() as u32);
                        (s.indent * em, 0.0, 0)
                    }
                    // the house's: indented unless it follows a head, a break or the start
                    _ => (if no_indent { 0.0 } else { EM_INDENT * em }, 0.0, 0),
                };
                let sh = Shape { first: p.measure - x1, rest: p.measure - x2, justify, hyphenate: p.hyphenate };
                let lines = break_lines(m, &b.text, &spans_with(b, 0, p.link_runs), &sh, lang);
                mk(lines, &b.text, 0, x1, x2, f, &mut para.lines);
                no_indent = b.kind != Kind::P;
            }
        }
        // attribution belongs with its verse: move the verse's space after past it
        if b.kind == Kind::Attrib
            && let Some(prev) = out.last_mut()
                && prev.space_after > 0 {
                    para.space_after = prev.space_after;
                    prev.space_after = 0;
                    prev.keep_with_next = true;
                }
        if !para.lines.is_empty() {
            out.push(para);
        }
    }
    out
}

/// Pours paragraphs into columns.
fn pour(paras: Vec<Para>, p: &Params, head_rows: u32) -> SectionLayout {
    let rows = p.rows.max(4);
    let mut col = 0u32;
    let mut row = head_rows;
    let mut lines: Vec<PLine> = Vec::with_capacity(paras.iter().map(|x| x.lines.len()).sum());
    let mut pending_after = 0u32;
    let n = paras.len();
    for (i, para) in paras.into_iter().enumerate() {
        let gap = para.space_before.max(pending_after);
        pending_after = para.space_after;
        if row > 0 && gap > 0 {
            // a gap the head or column start already provides is not added again
            if !(head_rows > 0 && col == 0 && row == head_rows) {
                row += gap;
            }
        }
        if row >= rows {
            col += 1;
            row = 0;
        }
        // a group is the lines that share a grid row (a table row's cells); for prose, one line
        let mut groups: Vec<std::ops::Range<usize>> = Vec::new();
        for (j, l) in para.lines.iter().enumerate() {
            if l.flags & flag::SAME_ROW != 0 && !groups.is_empty() {
                groups.last_mut().unwrap().end = j + 1;
            } else {
                groups.push(j..j + 1);
            }
        }
        let total = groups.len() as u32;
        // kept whole only if it can be: taller than a column, it splits like prose
        let whole = para.whole && total <= rows;
        let rem = rows - row;
        if whole && total > rem {
            col += 1;
            row = 0;
        }
        if para.keep_with_next && i + 1 < n && total + 2 > rows - row && row > 0 {
            col += 1;
            row = 0;
        }
        let mut left = groups.as_slice();
        while !left.is_empty() {
            let rem = (rows - row) as usize;
            let mut k = left.len().min(rem);
            if k < left.len() {
                // orphan: one line alone at a column foot moves on with the rest
                if k == 1 && row > 0 {
                    k = 0;
                }
                // widow: leave at least two lines for the next column
                if left.len() - k == 1 && k >= 3 {
                    k -= 1;
                }
            }
            for g in &left[..k] {
                for l in &para.lines[g.clone()] {
                    let mut l = *l;
                    l.col = col;
                    l.row = row;
                    lines.push(l);
                }
                row += 1;
            }
            left = &left[k..];
            if !left.is_empty() || row >= rows {
                col += 1;
                row = 0;
            }
        }
    }
    let cols = if row == 0 && col > 0 { col } else { col + 1 };
    SectionLayout { cols: cols.max(1), lines, head_rows }
}

/// Sets a section's paragraphs and pours them into columns under a head of `head_rows`.
pub fn layout_section(m: &mut Measurer, mono: &mut Mono, sec: &Section, images: &[Image], p: &Params, lang: Option<&Patterns>, head_rows: u32) -> SectionLayout {
    let paras = set_paras(m, mono, sec, images, p, lang);
    pour(paras, p, head_rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::Typeface;
    use typeset_model::{Block, Section, SectionKind};

    fn face(files: &[&str]) -> Typeface {
        let d = concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/fonts/");
        Typeface::single(files.iter().map(|f| std::fs::read(format!("{d}{f}")).unwrap()).collect()).unwrap()
    }

    /// A block of preformatted text set alone, in a measure of 400 px; the monospaced face
    /// it was set in, to measure with.
    fn preformatted(text: &str) -> (SectionLayout, Params, Mono) {
        let block = Block { key: 1, kind: Kind::Pre, text: text.into(), runs: vec![], links: vec![], image: None, table: None, set: None, rule: None };
        let sec = Section { kind: SectionKind::Chapter, part: String::new(), label: String::new(), num: String::new(), title: String::new(), blocks: vec![block], head: None };
        let p = Params { typo: Typo::plain(19.0, false), measure: 400.0, rows: 30, head_rows: 0, lh: 28.0, link_runs: false, justify: true, hyphenate: true };
        let mut m = Measurer::new(&face(&["Literata.ttf"]), p.typo, "en");
        let mut mono = Mono::new(Some(face(&["JetBrainsMono.ttf"])));
        (layout_section(&mut m, &mut mono, &sec, &[], &p, None, 0), p, mono)
    }

    #[test]
    fn preformatted_lines_keep_their_spaces_and_fit() {
        let text = "  Lat.    Summer   Winter\n\n  50 N      15.2     3.1\n".to_string() + &"0123456789 ".repeat(20);
        let (lay, p, _) = preformatted(&text);
        let pre: Vec<&PLine> = lay.lines.iter().filter(|l| l.flags & flag::SIZED != 0).collect();
        // one size for the whole block: too long a line for any size wraps rather than shrinks past 0.55 em
        let size = pre[0].spaces as f32 / 16.0;
        assert!(pre.iter().all(|l| l.spaces == pre[0].spaces));
        assert!((19.0 * 0.55..=19.0 * 0.82).contains(&size), "{size}");
        assert!(pre.iter().all(|l| l.natural <= l.avail), "{:?}", pre.iter().map(|l| l.natural).collect::<Vec<_>>());
        // the source lines and the blank one survive, and the long one wraps into several
        let u16s: Vec<u16> = text.encode_utf16().collect();
        let got: Vec<String> = pre.iter().map(|l| String::from_utf16(&u16s[l.s as usize..l.e as usize]).unwrap()).collect();
        assert_eq!(got[0], "  Lat.    Summer   Winter");
        assert_eq!(got[1], "");
        assert!(got.len() >= 5, "{got:?}");
        // wrapped at spaces (which go, as at any line's end), whole numbers kept, hung
        assert_eq!(got[3..].join(" ").trim_end(), "0123456789 ".repeat(20).trim_end());
        assert!(got[3..].iter().all(|l| l.trim_end().split(' ').all(|n| n == "0123456789")));
        assert!(pre[3].x == 0.0 && pre[4..].iter().all(|l| l.x > 0.0 && l.x + l.avail <= p.measure + 0.01));
        assert!(pre[0].flags & flag::FIRST != 0 && pre[1].flags & flag::FIRST == 0);
    }

    #[test]
    fn a_long_unbroken_preformatted_line_is_cut_in_few_measurements() {
        // minified code or base64: one line, no spaces, far wider than any measure. Each
        // piece's end is searched for, not walked back to a character at a time (which
        // shaped every prefix of the line: minutes, and a cache entry each)
        let text = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(400);
        let t = std::time::Instant::now();
        let (lay, _, mut mono) = preformatted(&text);
        assert!(t.elapsed().as_secs_f32() < 2.0, "{:?}", t.elapsed());
        let pre: Vec<&PLine> = lay.lines.iter().filter(|l| l.flags & flag::SIZED != 0).collect();
        // every piece fits, and is as long as fits: one more character would not
        assert!(pre.iter().all(|l| l.natural <= l.avail));
        let u16s: Vec<u16> = text.encode_utf16().collect();
        let size = pre[0].spaces as f32 / 16.0;
        for l in &pre[..pre.len() - 1] {
            let longer = String::from_utf16(&u16s[l.s as usize..l.e as usize + 1]).unwrap();
            assert!(mono.width(size, false, false, &longer).unwrap() > l.avail);
        }
        assert_eq!(pre.iter().map(|l| (l.e - l.s) as usize).sum::<usize>(), u16s.len());
    }

    fn table(text: &str, cols: u32) -> Section {
        let block = Block { key: 1, kind: Kind::Table, text: text.into(), runs: vec![], links: vec![], image: None, table: Some(typeset_model::TableShape { cols, header_rows: 0, spans: vec![] }), set: None, rule: None };
        Section { kind: SectionKind::Chapter, part: String::new(), label: String::new(), num: String::new(), title: String::new(), blocks: vec![block], head: None }
    }

    #[test]
    fn a_table_too_wide_for_the_measure_is_set_smaller_before_its_words_break() {
        let p = Params { typo: Typo::plain(19.0, false), measure: 560.0, rows: 30, head_rows: 0, lh: 28.0, link_runs: false, justify: true, hyphenate: true };
        let mut m = Measurer::new(&face(&["Literata.ttf"]), p.typo, "en");
        let mut mono = Mono::default();
        // six columns whose widest words fill more than the measure at 19 px, less at 15
        let row = "Temperature\tPressure\tHumidity\tVisibility\tDirection\tVelocity";
        let wide = table(&format!("{row}\n1\t2\t3\t4\t5\t6"), 6);
        let lay = layout_section(&mut m, &mut mono, &wide, &[], &p, None, 0);
        let cells: Vec<&PLine> = lay.lines.iter().filter(|l| l.flags & flag::CELL != 0 && l.e > l.s).collect();
        assert!(cells.iter().all(|l| l.flags & flag::SIZED != 0));
        let size = cells[0].spaces as f32 / 16.0;
        assert!(size < 19.0 && size >= (19.0f32 * 0.75).ceil() && size.fract() == 0.0, "{size}");
        // smaller, every word stays whole: twelve cells, twelve lines
        assert_eq!(cells.len(), 12);
        assert!(cells.iter().all(|l| l.natural <= l.avail + 0.01 && l.x + l.avail <= p.measure + 0.01));
        // a table that fits is set at the text's size
        let narrow = table("One\tTwo\nThree\tFour", 2);
        let lay = layout_section(&mut m, &mut mono, &narrow, &[], &p, None, 0);
        assert!(lay.lines.iter().all(|l| l.flags & flag::SIZED == 0));
    }

    #[test]
    fn a_spanning_cell_widens_its_columns_into_the_room_left() {
        let p = Params { typo: Typo::plain(19.0, false), measure: 560.0, rows: 30, head_rows: 0, lh: 28.0, link_runs: false, justify: true, hyphenate: true };
        let mut m = Measurer::new(&face(&["Literata.ttf"]), p.typo, "en");
        let mut sec = table("1.0\t2.0\t3.0\nA spanning cell of some length\t4.0", 3);
        sec.blocks[0].table.as_mut().unwrap().spans = vec![1, 1, 1, 2, 1];
        let lay = layout_section(&mut m, &mut Mono::default(), &sec, &[], &p, None, 0);
        let text = &sec.blocks[0].text;
        let start = text.find("A spanning").unwrap() as u32;
        let lines: Vec<&PLine> = lay.lines.iter().filter(|l| l.flags & flag::CELL != 0 && l.s >= start && l.s < start + 30).collect();
        assert_eq!(lines.len(), 1, "the spanning cell on one line");
        assert!(lines[0].natural <= lines[0].avail);
    }
}
