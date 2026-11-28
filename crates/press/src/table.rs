//! A table set on the press's rows: one paragraph per table row, its columns sized as a
//! browser sizes a table's, each cell broken by the same line breaker as the text.

use crate::brk::break_lines;
use crate::fill::{Para, Params, PLine, flag, spans_with};
use crate::hyph::Patterns;
use crate::shape::Measurer;

/// A table, as one paragraph per table row. Columns are sized as browsers size tables:
/// each column wants room for its widest word (min) and for its cells unbroken (max); if
/// the maxima fit the measure they are used, else the room between minima and maxima is
/// shared out, else the minima are scaled down and words break. Every cell is set by the
/// breaker in its column's width, ragged, so a table obeys the same rules as text.
pub(crate) fn set_table(m: &mut Measurer, b: &typeset_model::Block, bi: u32, p: &Params, lang: Option<&Patterns>) -> Vec<Para> {
    let shape = b.table.clone().unwrap_or_default();
    let em = p.typo.size;
    let spans = spans_with(b, 0, p.link_runs);
    // the cells: (row, first column, span, byte start, byte end)
    let mut cells: Vec<(u32, u32, u32, usize, usize)> = Vec::new();
    let mut k = 0usize;
    let mut at = 0usize;
    for (ri, row) in b.text.split('\n').enumerate() {
        let mut col = 0u32;
        let mut a = at;
        for cell in row.split('\t') {
            let span = shape.spans.get(k).copied().unwrap_or(1).max(1) as u32;
            cells.push((ri as u32, col, span, a, a + cell.len()));
            col += span;
            k += 1;
            a += cell.len() + 1;
        }
        at += row.len() + 1;
    }
    let n = shape.cols.max(cells.iter().map(|c| c.1 + c.2).max().unwrap_or(1)) as usize;
    // Each column's least width (its widest word, or with `hyph` its widest syllable run
    // with its hyphen) and most (its widest line as written, forced breaks kept), from
    // the cells one column wide; spanning cells widen theirs afterwards.
    let bounds = |m: &mut Measurer, hyph: bool, cells: &[(u32, u32, u32, usize, usize)]| {
        let sp = crate::brk::Spans { spans: &spans };
        let (mut lo, mut hi) = (vec![0f32; n], vec![0f32; n]);
        let mut span_need: Vec<(usize, usize, f32, f32)> = Vec::new();
        for &(_, c, span, s, e) in cells {
            if e <= s {
                continue;
            }
            let (mut widest, mut longest) = (0f32, 0f32);
            let mut ls = s;
            for line in b.text[s..e].split('\u{2028}') {
                longest = longest.max(sp.width(m, &b.text, ls, ls + line.len()));
                let mut ws = ls;
                for w in line.split(' ') {
                    let cuts = match lang {
                        Some(l) if hyph && sp.single_style(ws, ws + w.len()).is_some() => crate::brk::syllable_cuts(w, l),
                        _ => Vec::new(),
                    };
                    let mut a = 0;
                    for (i, c) in cuts.iter().copied().chain(std::iter::once(w.len())).enumerate() {
                        let hyphen = if i < cuts.len() { m.hyphen } else { 0.0 };
                        widest = widest.max(sp.width(m, &b.text, ws + a, ws + c) + hyphen);
                        a = c;
                    }
                    ws += w.len() + 1;
                }
                ls += line.len() + '\u{2028}'.len_utf8();
            }
            if span == 1 {
                lo[c as usize] = lo[c as usize].max(widest);
                hi[c as usize] = hi[c as usize].max(longest);
            } else {
                span_need.push((c as usize, (c + span) as usize, widest, longest));
            }
        }
        (lo, hi, span_need)
    };
    // the gap between columns: an em, down to half of one if that lets whole words fit
    let gaps = (n as f32 - 1.0).max(0.0);
    let gutter_for = |least: f32, size: f32| -> Option<f32> {
        if least + size * gaps <= p.measure {
            Some(size)
        } else if least + size * 0.5 * gaps <= p.measure {
            Some(if gaps > 0.0 { (p.measure - least) / gaps } else { size })
        } else {
            None
        }
    };
    // The largest size, a whole px at a time down to 0.75 em, at which the table fits
    // with its words whole; hyphenated, once already set a little smaller (0.85 em) and
    // the hyphens then let it stay larger; past all that, words break where they must.
    let (mut lo, mut hi, mut span_need) = bounds(m, false, &cells);
    let mut small: Option<Measurer> = None;
    let gutter;
    let least: f32 = lo.iter().sum();
    match gutter_for(least, em) {
        Some(g) => gutter = g,
        None => {
            let floor = (em * 0.75).ceil();
            let hyph_from = (em * 0.85).floor();
            let mut size = (em - 1.0).floor().max(floor);
            loop {
                let mut sm = m.at_size(size);
                let (l, h, sn) = bounds(&mut sm, false, &cells);
                let mut got = gutter_for(l.iter().sum(), size).map(|g| (g, l, h, sn));
                if got.is_none() && (size <= hyph_from || size <= floor) {
                    let (l, h, sn) = bounds(&mut sm, true, &cells);
                    // at the last size, words break where they must, between half-em gutters
                    let g = gutter_for(l.iter().sum(), size).or((size <= floor).then_some(size * 0.5));
                    got = g.map(|g| (g, l, h, sn));
                }
                if let Some((g, l, h, sn)) = got {
                    (gutter, lo, hi, span_need) = (g, l, h, sn);
                    small = Some(sm);
                    break;
                }
                size = (size - 1.0).max(floor);
            }
        }
    }
    let sized = small.as_ref().map(|sm| (sm.size * 16.0) as u16);
    let m: &mut Measurer = match small.as_mut() {
        Some(sm) => sm,
        None => m,
    };
    let em = m.size;
    let avail = (p.measure - gutter * gaps).max(n as f32);
    let (sl, sh): (f32, f32) = (lo.iter().sum(), hi.iter().sum());
    let mut widths: Vec<f32> = if sh <= avail {
        hi.clone()
    } else if sl <= avail && sh > sl {
        let t = (avail - sl) / (sh - sl);
        lo.iter().zip(&hi).map(|(a, z)| a + (z - a) * t).collect()
    } else if sl > 0.0 {
        lo.iter().map(|a| a * avail / sl).collect()
    } else {
        vec![avail / n as f32; n]
    };
    // a column with nothing in it still takes a sliver
    for w in widths.iter_mut() {
        *w = w.max(em);
    }
    // a spanning cell wider than its columns takes what room the table has left, spread
    // over them, narrowest spans first
    span_need.sort_by_key(|s| s.1 - s.0);
    for &(c, e, _, longest) in &span_need {
        let e = e.min(n);
        let have: f32 = widths[c..e].iter().sum::<f32>() + gutter * (e - c - 1) as f32;
        let slack = avail - widths.iter().sum::<f32>();
        // (a hundredth over, so the sum of floats is not a hair short of the text)
        let add = (longest - have + 0.01).min(slack);
        if add > 0.0 {
            for w in &mut widths[c..e] {
                *w += add / (e - c) as f32;
            }
        }
    }
    let mut x = vec![0f32; n + 1];
    for i in 0..n {
        x[i + 1] = x[i] + widths[i] + gutter;
    }
    let table_w = (x[n] - gutter).min(p.measure);
    let mut cur = typeset_model::js::U16Cursor::new(&b.text);
    let mut out: Vec<Para> = Vec::new();
    let nrows = cells.iter().map(|c| c.0).max().map(|r| r + 1).unwrap_or(0);
    for r in 0..nrows {
        // each cell's lines, then the row's lines laid out row by row of the grid
        let mut set: Vec<(f32, f32, Vec<crate::brk::Line>, usize)> = Vec::new();
        for &(_, c, span, s, e) in cells.iter().filter(|c| c.0 == r) {
            let (c, span) = (c as usize, span as usize);
            // summed, not subtracted from positions: a word exactly as wide as its column
            // must not come out a hair wider than it
            let end = (c + span).min(n);
            let w = (widths[c..end].iter().sum::<f32>() + gutter * (end - c - 1) as f32).max(em).min(p.measure - x[c]);
            let cell_spans: Vec<(usize, usize, u8)> = spans.iter().filter(|&&(a, z, _)| z > s && a < e).map(|&(a, z, st)| (a.max(s) - s, z.min(e) - s, st)).collect();
            let sh = crate::brk::Shape { first: w, rest: w, justify: false, hyphenate: w < em * 14.0 };
            let lines = if e > s { break_lines(m, &b.text[s..e], &cell_spans, &sh, if sh.hyphenate { lang } else { None }) } else { Vec::new() };
            set.push((x[c], w, lines, s));
        }
        let height = set.iter().map(|c| c.2.len()).max().unwrap_or(0).max(1);
        let mut para = Para { lines: Vec::new(), space_before: 0, space_after: 0, keep_with_next: r < shape.header_rows, whole: true };
        for line in 0..height {
            let mut grid_row: Vec<PLine> = Vec::new();
            if line == 0 && r > 0 {
                grid_row.push(PLine { col: 0, row: 0, block: bi, s: 0, e: 0, x: 0.0, avail: table_w, natural: 0.0, spaces: 0, flags: flag::RULE });
            }
            for (cx, w, lines, base) in &set {
                if let Some(l) = lines.get(line) {
                    let s = cur.at(base + l.s as usize);
                    let e = cur.at(base + l.e as usize);
                    let mut f = if l.hyph { flag::CELL | flag::HYPH } else { flag::CELL };
                    if sized.is_some() {
                        f |= flag::SIZED;
                    }
                    grid_row.push(PLine { col: 0, row: 0, block: bi, s, e, x: *cx, avail: *w, natural: l.natural, spaces: sized.unwrap_or(l.spaces), flags: f });
                }
            }
            // a grid row with no cell text in it still takes its row
            if grid_row.is_empty() {
                grid_row.push(PLine { col: 0, row: 0, block: bi, s: 0, e: 0, x: 0.0, avail: 0.0, natural: 0.0, spaces: 0, flags: flag::CELL });
            }
            for (j, mut pl) in grid_row.into_iter().enumerate() {
                if j > 0 {
                    pl.flags |= flag::SAME_ROW;
                }
                para.lines.push(pl);
            }
        }
        out.push(para);
    }
    out
}
