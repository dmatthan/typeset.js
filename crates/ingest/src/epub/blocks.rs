//! The blocks the walk sets whole rather than as running text: a figure (its pictures,
//! then its caption), a table (its rows and cells as one block), preformatted text (its
//! lines and spaces as written).
use super::*;

impl Extractor {
    /// A figure or a lone image: its images as image blocks, then its caption.
    pub(super) fn figure(&mut self, e: ElementRef) {
        if let Some(id) = e.value().id() {
            let full = format!("{}#{}", self.path, id);
            self.see_id(full, false);
        }
        let imgs: Vec<_> = if e.value().name().eq_ignore_ascii_case("img") { vec![e] } else { e.descendent_elements().filter(|d| d.value().name().eq_ignore_ascii_case("img")).collect() };
        for img in imgs {
            if let Some(src) = image_src(&img, &self.path) {
                self.push_image(src);
            }
        }
        // a figure drawn in SVG, or a diagram in a table
        for d in e.descendent_elements() {
            let n = d.value().name().to_ascii_lowercase();
            if (n == "svg" && rich::is_figure_svg(&d)) || (n == "table" && rich::is_diagram_table(&d)) || n == "math" {
                self.rich(d);
            }
        }
        if let Some(cap) = e.descendent_elements().find(|d| d.value().name().eq_ignore_ascii_case("figcaption")) {
            let mut b = TextBuilder::new();
            let mut cx = Inl { path: &self.path, ids: vec![], images: vec![] };
            // a caption in italic, as captions are set (its own styles may still undo it)
            inline(cap, &mut b, css::apply(style::ITALIC, css::of(&cap)), &mut cx);
            let cx = Inl { path: "", ids: cx.ids, images: vec![] };
            self.absorb(cx);
            self.push(Kind::Center, b);
        }
    }

    /// A table: its rows and cells as one block (`Kind::Table`). Rows come from `tr` in
    /// order (a nested table is read as text in its cell); a row of `th` at the head is a
    /// header row, set in bold.
    pub(super) fn table(&mut self, e: ElementRef) {
        if let Some(id) = e.value().id() {
            let full = format!("{}#{}", self.path, id);
            self.see_id(full, false);
        }
        let is = |x: &ElementRef, n: &str| x.value().name().eq_ignore_ascii_case(n);
        // the rows of this table, not of tables nested in its cells
        let mut rows: Vec<ElementRef> = Vec::new();
        fn rows_of<'a>(el: ElementRef<'a>, out: &mut Vec<ElementRef<'a>>) {
            for c in el.child_elements() {
                match c.value().name().to_ascii_lowercase().as_str() {
                    "tr" => out.push(c),
                    "thead" | "tbody" | "tfoot" => rows_of(c, out),
                    _ => {}
                }
            }
        }
        rows_of(e, &mut rows);
        let mut b = TextBuilder::new();
        let mut shape = typeset_model::TableShape::default();
        let mut first_row = true;
        for tr in rows {
            let cells: Vec<ElementRef> = tr.child_elements().filter(|c| is(c, "td") || is(c, "th")).collect();
            if cells.is_empty() {
                continue;
            }
            if !first_row {
                b.newline();
            }
            let header = first_row && cells.iter().all(|c| is(c, "th"));
            let mut cols = 0u32;
            for (i, c) in cells.iter().enumerate() {
                if i > 0 {
                    b.cell();
                }
                let span = c.attr("colspan").and_then(|v| v.trim().parse::<u8>().ok()).unwrap_or(1).clamp(1, 20);
                shape.spans.push(span);
                cols += span as u32;
                // a cell is built on its own: its line breaks are U+2028 (a forced break the
                // breaker honours), so they never read as the table's row separators
                let mut cb = TextBuilder::new();
                self.collect(*c, &mut cb, if is(c, "th") { style::BOLD } else { 0 });
                let (t, mut r, mut l) = cb.finish_with_links();
                // (U+2028 is three bytes where '\n' was one: what lies after each moves on)
                let at = |o: u32| o + 2 * t.as_bytes()[..o as usize].iter().filter(|&&c| c == b'\n').count() as u32;
                for x in &mut r {
                    (x.start, x.end) = (at(x.start), at(x.end));
                }
                for x in &mut l {
                    (x.0, x.1) = (at(x.0), at(x.1));
                }
                b.append(&t.replace('\n', "\u{2028}"), &r, &l);
            }
            if header {
                shape.header_rows = 1;
            }
            shape.cols = shape.cols.max(cols);
            first_row = false;
        }
        if shape.spans.is_empty() || b.is_empty() {
            return;
        }
        if self.push(Kind::Table, b).is_some() {
            self.sections.last_mut().unwrap().blocks.last_mut().unwrap().block.table = Some(shape);
        }
    }

    /// Preformatted text: its lines and spaces as written (the leading newline HTML ignores
    /// is dropped, tabs become spaces to stops of eight, trailing spaces and blank lines go).
    pub(super) fn pre(&mut self, e: ElementRef) {
        if let Some(id) = e.value().id() {
            let full = format!("{}#{}", self.path, id);
            self.see_id(full, false);
        }
        fn gather(el: ElementRef, out: &mut String) {
            for c in el.children() {
                match c.value() {
                    Node::Text(t) => out.push_str(t),
                    Node::Element(_) => {
                        let ce = ElementRef::wrap(c).unwrap();
                        let n = ce.value().name().to_ascii_lowercase();
                        if n == "br" {
                            out.push('\n');
                        } else if !SKIP.contains(&n.as_str()) {
                            gather(ce, out);
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut raw = String::new();
        gather(e, &mut raw);
        let raw = raw.replace("\r\n", "\n").replace('\r', "\n");
        let raw = raw.strip_prefix('\n').unwrap_or(&raw);
        let mut lines: Vec<String> = raw
            .split('\n')
            .map(|l| {
                let mut out = String::new();
                for c in l.chars() {
                    if c == '\t' {
                        let n = 8 - out.chars().count() % 8;
                        out.extend(std::iter::repeat_n(' ', n));
                    } else if c != '\u{feff}' {
                        out.push(c);
                    }
                }
                out.trim_end().to_string()
            })
            .collect();
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        while lines.first().is_some_and(|l| l.is_empty()) {
            lines.remove(0);
        }
        if lines.is_empty() {
            return;
        }
        // indentation the whole block shares only moves it off the text's margin
        let common = lines.iter().filter(|l| !l.is_empty()).map(|l| l.len() - l.trim_start_matches(' ').len()).min().unwrap_or(0);
        let mut b = TextBuilder::new();
        b.append(&lines.iter().map(|l| l.get(common..).unwrap_or("")).collect::<Vec<_>>().join("\n"), &[], &[]);
        self.push(Kind::Pre, b);
    }
}
