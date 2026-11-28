//! The publisher's styles, as far as they change what the press sets: what is hidden
//! (`display: none`, `visibility: hidden`: a Kindle-only heading, a layout note, a page
//! number kept for print), and italic, bold, small capitals, superscript and subscript
//! given by class rather than by tag (InDesign, Calibre and most commercial EPUBs); and
//! for a chapter's head, its size and the space above it. The book's structure is its
//! own (its heads, as Apple Books' Original keeps them); its texture (faces, the text's
//! size, colours) is the theme's, but for the leading the text is set in, which a theme
//! may take as the book's own (as Original does).
//!
//! Selectors are matched by the HTML parser's own engine (scraper), so they mean what
//! they mean in a browser; the cascade is specificity, then source order, then the
//! element's own `style`. `@media` rules for print or for Kindle are left out; rules on
//! pseudo-elements (`::before`, `:first-letter`) cannot change text and are skipped.

use ego_tree::NodeId;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashMap;

/// What a rule (or the cascade) says of an element; `None` where it says nothing.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub(crate) struct Props {
    pub hidden: Option<bool>,
    pub italic: Option<bool>,
    pub bold: Option<bool>,
    pub smcp: Option<bool>,
    /// 1 superscript, -1 subscript, 0 on the baseline.
    pub va: Option<i8>,
    /// A block's alignment: 0 justified, 1 centred, 2 at the end, 3 at the start (left).
    pub align: Option<u8>,
    /// For a chapter's head: its size as a factor of its parent's, and the space above and
    /// below it (margins, paddings) in its own em.
    pub size: Option<f32>,
    pub margin_top: Option<f32>,
    pub padding_top: Option<f32>,
    pub margin_bottom: Option<f32>,
    pub padding_bottom: Option<f32>,
    /// A paragraph's first-line indent, in its em.
    pub indent: Option<f32>,
    /// Its line-height as a factor of its size; 0 for `normal` (the browser's own).
    pub leading: Option<f32>,
    /// For a rule (`hr`): whether its border shows, its width as a share of its parent's,
    /// and whether it is centred (`margin: auto`, as a browser's own is).
    pub border: Option<bool>,
    pub width: Option<f32>,
    pub centred: Option<bool>,
}

impl Props {
    fn any(&self) -> bool {
        *self != Props::default()
    }
    fn over(&mut self, o: &Props) {
        self.hidden = o.hidden.or(self.hidden);
        self.italic = o.italic.or(self.italic);
        self.bold = o.bold.or(self.bold);
        self.smcp = o.smcp.or(self.smcp);
        self.va = o.va.or(self.va);
        self.align = o.align.or(self.align);
        self.size = o.size.or(self.size);
        self.margin_top = o.margin_top.or(self.margin_top);
        self.padding_top = o.padding_top.or(self.padding_top);
        self.margin_bottom = o.margin_bottom.or(self.margin_bottom);
        self.padding_bottom = o.padding_bottom.or(self.padding_bottom);
        self.indent = o.indent.or(self.indent);
        self.leading = o.leading.or(self.leading);
        self.border = o.border.or(self.border);
        self.width = o.width.or(self.width);
        self.centred = o.centred.or(self.centred);
    }
}

/// A style sheet's rules that matter here: (selector text, what it says).
pub(crate) type Sheet = Vec<(String, Props)>;

/// Reads a style sheet (a file's, or a `<style>` element's).
pub(crate) fn parse_sheet(src: &str) -> Sheet {
    let mut out = Vec::new();
    rules(&strip_comments(src), &mut out);
    out
}

fn strip_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        rest = rest[i + 2..].find("*/").map(|j| &rest[i + 2 + j + 2..]).unwrap_or("");
    }
    out.push_str(rest);
    out
}

/// The block that starts after `open` (the index of a '{'): its inside, and where it ends.
fn block(s: &str, open: usize) -> (&str, usize) {
    let mut depth = 0;
    for (i, c) in s[open..].char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return (&s[open + 1..open + i], open + i + 1);
                }
            }
            _ => {}
        }
    }
    (&s[open + 1..], s.len())
}

/// Each style rule of a sheet, as (selector, declarations), in order: statement at-rules
/// (@import, @charset, @namespace) are passed over, and group rules that apply to a
/// screen (`@media`, `@supports`) are read into.
fn each_rule<'a>(s: &'a str, f: &mut impl FnMut(&'a str, &'a str)) {
    let mut at = 0;
    while at < s.len() {
        let rest = s[at..].trim_start();
        at = s.len() - rest.len();
        if rest.is_empty() {
            break;
        }
        let open = rest.find('{');
        if rest.starts_with('@') {
            let semi = rest.find(';');
            if semi.is_some_and(|i| open.is_none_or(|o| i < o)) {
                at += semi.unwrap() + 1;
                continue;
            }
        }
        let Some(open) = open else { break };
        let prelude = rest[..open].trim();
        let (inside, end) = block(rest, open);
        at += end;
        if let Some(at_rule) = prelude.strip_prefix('@') {
            let lower = at_rule.to_ascii_lowercase();
            if (lower.starts_with("media") && media_applies(&lower[5..])) || lower.starts_with("supports") {
                each_rule(inside, f);
            }
            continue;
        }
        f(prelude, inside);
    }
}

fn rules(s: &str, out: &mut Sheet) {
    each_rule(s, &mut |prelude, inside| {
        let props = declarations(inside);
        if !props.any() {
            return;
        }
        for sel in prelude.split(',') {
            let sel = sel.trim();
            let l = sel.to_ascii_lowercase();
            if sel.is_empty()
                || l.contains("::")
                || [":before", ":after", ":first-letter", ":first-line", ":hover", ":focus", ":active", ":visited"]
                    .iter()
                    .any(|p| l.contains(p))
            {
                continue;
            }
            out.push((sel.to_string(), props));
        }
    });
}

/// `@media` for screens (or all): not print, not Kindle (`amzn-kf8`, `amzn-mobi`).
fn media_applies(q: &str) -> bool {
    !(q.contains("amzn")
        || q.contains("kindle")
        || (q.contains("print") && !q.contains("screen"))
        || q.contains("speech"))
}

pub(crate) fn declarations(src: &str) -> Props {
    let mut p = Props::default();
    for d in src.split(';') {
        let Some((name, value)) = d.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let v = value.to_ascii_lowercase().replace("!important", "");
        let v = v.trim();
        match name.as_str() {
            "display" => p.hidden = Some(v == "none"),
            "visibility" => p.hidden = Some(v == "hidden" || v == "collapse"),
            "font-style" => p.italic = Some(v.starts_with("italic") || v.starts_with("oblique")),
            "font-weight" => p.bold = weight(v),
            "font-variant" | "font-variant-caps" => p.smcp = Some(v.contains("small-caps")),
            "text-align" => {
                p.align = match v {
                    "center" | "-webkit-center" => Some(1),
                    "right" | "end" => Some(2),
                    "justify" => Some(0),
                    "left" | "start" => Some(3),
                    _ => None,
                }
            }
            "vertical-align" => {
                p.va = match v {
                    "super" | "text-top" => Some(1),
                    "sub" | "text-bottom" => Some(-1),
                    "baseline" => Some(0),
                    _ => None,
                }
            }
            "font-size" => p.size = size(v),
            "margin-top" => p.margin_top = length(v),
            "padding-top" => p.padding_top = length(v),
            "margin-bottom" => p.margin_bottom = length(v),
            "padding-bottom" => p.padding_bottom = length(v),
            "text-indent" => p.indent = length(v),
            "line-height" => p.leading = leading(v),
            "margin" => {
                (p.margin_top, p.margin_bottom) = top_bottom(v);
                p.centred = across(v).map(|x| x == "auto");
            }
            "margin-left" | "margin-right" => p.centred = Some(v == "auto"),
            "border" | "border-top" | "border-bottom" | "border-style" | "border-top-style" => {
                p.border = Some(shows(v))
            }
            "width" => p.width = v.strip_suffix('%').and_then(|x| x.trim().parse::<f32>().ok()).map(|x| x / 100.0),
            "padding" => (p.padding_top, p.padding_bottom) = top_bottom(v),
            "font" => {
                for w in v.split_whitespace() {
                    // (`size/line-height`)
                    if let Some((_, lh)) = w.split_once('/') {
                        p.leading = leading(lh);
                    }
                    match w {
                        "italic" | "oblique" => p.italic = Some(true),
                        "small-caps" => p.smcp = Some(true),
                        _ => {
                            if let Some(b) = weight(w).filter(|_| w != "normal") {
                                p.bold = Some(b);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    p
}

/// A length in em: em (and rem, the text's), px and pt at a browser's 16 px; none for a
/// percentage (of a width, for a margin) or what cannot be read.
fn length(v: &str) -> Option<f32> {
    let n = |s: &str| s.trim().parse::<f32>().ok();
    if v == "0" {
        return Some(0.0);
    }
    if let Some(x) = v.strip_suffix("rem").or_else(|| v.strip_suffix("em")) {
        return n(x);
    }
    if let Some(x) = v.strip_suffix("px") {
        return n(x).map(|x| x / 16.0);
    }
    v.strip_suffix("pt").and_then(n).map(|x| x / 12.0)
}

/// A line-height as a factor of the element's size: a number, a percentage, a length in em
/// (px and pt at a browser's 16); 0 for `normal`.
fn leading(v: &str) -> Option<f32> {
    if v == "normal" {
        return Some(0.0);
    }
    if let Some(x) = v.strip_suffix('%') {
        return x.trim().parse::<f32>().ok().map(|x| x / 100.0);
    }
    v.parse::<f32>().ok().or_else(|| length(v)).filter(|x| *x > 0.0)
}

/// A margin shorthand's right side (one value: it; two or three: the second; four: the
/// second, the right).
fn across(v: &str) -> Option<&str> {
    let w: Vec<&str> = v.split_whitespace().collect();
    match w.len() {
        1 => Some(w[0]),
        2..=4 => Some(w[1]),
        _ => None,
    }
}

/// Whether a border so written draws a line: not `none`, `hidden`, or a width of nothing.
fn shows(v: &str) -> bool {
    !v.split_whitespace().any(|w| matches!(w, "none" | "hidden")) && !matches!(v, "0" | "0px" | "0em")
}

/// A shorthand's top and bottom: one or two values, the first both; three or four, the
/// first and the third.
fn top_bottom(v: &str) -> (Option<f32>, Option<f32>) {
    let w: Vec<&str> = v.split_whitespace().collect();
    match w.len() {
        1 | 2 => (length(w[0]), length(w[0])),
        3 | 4 => (length(w[0]), length(w[2])),
        _ => (None, None),
    }
}

/// A font size as a factor of the parent's: a length in em, a percentage, or a keyword
/// (the absolute ones taken against the text's, as a book's heads are).
fn size(v: &str) -> Option<f32> {
    if let Some(x) = v.strip_suffix('%') {
        return x.trim().parse::<f32>().ok().map(|x| x / 100.0);
    }
    match v {
        "xx-small" => Some(0.6),
        "x-small" => Some(0.75),
        "small" | "smaller" => Some(0.89),
        "medium" => Some(1.0),
        "large" | "larger" => Some(1.2),
        "x-large" => Some(1.5),
        "xx-large" => Some(2.0),
        "xxx-large" => Some(3.0),
        _ => length(v),
    }
}

fn weight(v: &str) -> Option<bool> {
    match v {
        "bold" | "bolder" => Some(true),
        "normal" | "lighter" => Some(false),
        _ => v.parse::<u32>().ok().map(|n| n >= 600),
    }
}

/// (ids, classes and attributes and pseudo-classes, elements), counted from the text.
fn specificity(sel: &str) -> (u16, u16, u16) {
    let (mut a, mut b, mut c) = (0, 0, 0);
    let mut chars = sel.chars().peekable();
    let mut prev_boundary = true;
    while let Some(ch) = chars.next() {
        match ch {
            '#' => a += 1,
            '.' | '[' | ':' => b += 1,
            ' ' | '>' | '+' | '~' | '(' | ')' | '*' => {}
            _ if prev_boundary && ch.is_ascii_alphabetic() => c += 1,
            _ => {}
        }
        prev_boundary = matches!(ch, ' ' | '>' | '+' | '~' | '(');
        if ch == '[' {
            for x in chars.by_ref() {
                if x == ']' {
                    break;
                }
            }
        }
    }
    (a, b, c)
}

/// The cascade over one document: what applies to each element that any rule touches
/// (each element's own; inheritance is the reader's: italic flows into children as the
/// text is gathered).
pub(crate) fn cascade(doc: &Html, sheets: &[&Sheet]) -> HashMap<NodeId, Props> {
    let mut hits: HashMap<NodeId, Vec<((u16, u16, u16), usize, Props)>> = HashMap::new();
    let mut order = 0;
    for sheet in sheets {
        for (sel, props) in sheet.iter() {
            order += 1;
            let Ok(s) = Selector::parse(sel) else { continue };
            let spec = specificity(sel);
            for el in doc.select(&s) {
                hits.entry(el.id()).or_default().push((spec, order, *props));
            }
        }
    }
    let mut out: HashMap<NodeId, Props> = HashMap::new();
    for (id, mut v) in hits {
        v.sort_by_key(|(spec, ord, _)| (*spec, *ord));
        let mut p = Props::default();
        for (_, _, q) in &v {
            p.over(q);
        }
        out.insert(id, p);
    }
    // an element's own style attribute comes last
    for el in doc.root_element().descendants().filter_map(ElementRef::wrap) {
        if let Some(st) = el.attr("style") {
            let q = declarations(st);
            if q.any() {
                out.entry(el.id()).or_default().over(&q);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_matters_and_skips_the_rest() {
        let s = parse_sheet(
            "@charset \"utf-8\"; /* a comment { } */ @import url(x.css);
             p.hide, .x { display: none; margin: 0 }
             span.it { font-style: italic }
             .b { font-weight: 700 } .n { font-weight: 400 }
             .sc { font-variant: small-caps }
             @media amzn-kf8 { .k { display: none } }
             @media screen { .s { display: none } }
             h1::before { content: 'x'; display: none }
             .f { font: italic bold 1em serif }
             .m { margin: 1em 0 2em }
             .c { color: red }",
        );
        let get = |sel: &str| s.iter().find(|(x, _)| x == sel).map(|(_, p)| *p);
        assert_eq!(get("p.hide").unwrap().hidden, Some(true));
        assert_eq!(get(".x").unwrap().hidden, Some(true));
        assert_eq!(get("span.it").unwrap().italic, Some(true));
        assert_eq!(get(".b").unwrap().bold, Some(true));
        assert_eq!(get(".n").unwrap().bold, Some(false));
        assert_eq!(get(".sc").unwrap().smcp, Some(true));
        assert!(get(".k").is_none(), "Kindle-only rules are not this reader's");
        assert_eq!(get(".s").unwrap().hidden, Some(true));
        assert!(get("h1::before").is_none());
        assert_eq!(get(".f").unwrap(), Props { italic: Some(true), bold: Some(true), ..Props::default() });
        // (the space around a chapter's head: a shorthand's top and its bottom)
        assert_eq!((get(".m").unwrap().margin_top, get(".m").unwrap().margin_bottom), (Some(1.0), Some(2.0)));
        assert!(get(".c").is_none(), "rules that change nothing here are not kept");
    }

    #[test]
    fn specificity_then_order_then_the_element_itself() {
        let doc = Html::parse_document(
            r#"<html><body><p class="a b" id="p">x</p><p class="a" style="font-style: italic">y</p></body></html>"#,
        );
        let sheet = parse_sheet(
            "p.a { font-style: italic } .a { font-style: normal } #p { display: none } .a.b { font-style: normal }",
        );
        let c = cascade(&doc, &[&sheet]);
        let ps: Vec<_> = doc.select(&Selector::parse("p").unwrap()).collect();
        assert_eq!(c[&ps[0].id()], Props { hidden: Some(true), italic: Some(false), ..Props::default() });
        // p.a (0,1,1) beats .a (0,1,0); the style attribute beats both
        assert_eq!(c[&ps[1].id()].italic, Some(true));
        assert_eq!(specificity("div#x .a > p:first-child[lang]"), (1, 3, 2));
    }
}

thread_local! {
    /// The cascade of the document being read (set per spine document by `epub/`).
    static NOW: std::cell::RefCell<HashMap<NodeId, Props>> = std::cell::RefCell::new(HashMap::new());
}

/// Makes `c` the cascade of the document being read.
pub(crate) fn set(c: HashMap<NodeId, Props>) {
    NOW.with(|n| *n.borrow_mut() = c);
}

/// What the publisher's styles say of an element of the document being read.
pub(crate) fn of(e: &ElementRef) -> Props {
    NOW.with(|n| n.borrow().get(&e.id()).copied().unwrap_or_default())
}

/// The element is not shown (`display: none`, `visibility: hidden`).
pub(crate) fn hidden(e: &ElementRef) -> bool {
    of(e).hidden == Some(true)
}

/// A style (typeset_model::style) as an element's own declarations change it.
pub(crate) fn apply(st: u8, p: Props) -> u8 {
    use typeset_model::style::*;
    let mut st = st;
    let mut set = |on: Option<bool>, bit: u8| match on {
        Some(true) => st |= bit,
        Some(false) => st &= !bit,
        None => {}
    };
    set(p.italic, ITALIC);
    set(p.bold, BOLD);
    set(p.smcp, SMALLCAPS);
    match p.va {
        Some(1) => st = (st | SUP) & !SUB,
        Some(-1) => st = (st | SUB) & !SUP,
        Some(_) => st &= !(SUP | SUB),
        None => {}
    }
    st
}

/// A style sheet's rules as written, (selector, declarations), for what is drawn by the
/// browser as it is (a rich block: `rich.rs`). Only plain style rules: no at-rules.
pub(crate) fn raw_rules(src: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    each_rule(&strip_comments(src), &mut |prelude, inside| out.push((prelude.to_string(), inside.trim().to_string())));
    out
}
