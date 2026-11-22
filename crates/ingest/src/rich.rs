//! Rich blocks: what the press cannot set from text, drawn instead by the browser as the
//! publisher made it, as a picture in the column (a tap enlarges it, as any image). A
//! genealogy drawn as a table of mostly empty cells with ruled edges, a figure in inline
//! SVG, a formula in MathML: their meaning is in their shape.
//!
//! A rich block is kept as an image whose bytes are well-formed XHTML (the reader draws
//! it inside an SVG `foreignObject`, which shows markup as a picture: no scripts, no
//! fetching, scaled like any image) with the publisher's rules that apply inside it.
//! Colours, faces and backgrounds are left to the reader (ink on transparent, so it sits
//! on any paper; inverted on dark ones); images inside are left out (a picture cannot
//! fetch them), their descriptions kept.

use ego_tree::NodeRef;
use scraper::{ElementRef, Node, Selector};

/// A table that is a drawing rather than a table of data: a third or more of its cells
/// empty (the space a tree's lines run through), or lines drawn with box characters.
pub(crate) fn is_diagram_table(t: &ElementRef) -> bool {
    let cells: Vec<_> = t.descendent_elements().filter(|e| matches!(e.value().name(), "td" | "th")).collect();
    if cells.len() < 12 {
        return false;
    }
    let lines = |s: &str| !s.trim().is_empty() && s.trim().chars().all(|c| "│─┬┴├┤┌┐└┘┼|/\\_—–-=┃━ ".contains(c));
    let empty = cells.iter().filter(|c| { let t: String = c.text().collect(); t.trim().is_empty() || lines(&t) }).count();
    empty * 3 >= cells.len()
}

/// An inline SVG that is a figure of its own (not the cover's frame around one image).
pub(crate) fn is_figure_svg(e: &ElementRef) -> bool {
    let kids: Vec<_> = e.descendent_elements().map(|d| d.value().name().to_ascii_lowercase()).collect();
    !(kids.iter().any(|n| n == "image") && !kids.iter().any(|n| matches!(n.as_str(), "text" | "path" | "line" | "rect" | "circle" | "polyline" | "polygon")))
}

const VOID: &[&str] = &["br", "hr", "col", "wbr"];

// What a rich block may hold is listed, not what it may not: anything else is left out,
// and an element not listed gives way to what is inside it. Only what draws is listed;
// nothing that runs, fetches, animates or goes anywhere.

/// Elements kept, by their lower-case names: HTML's text and tables, SVG's shapes and
/// text, MathML's presentation.
const ELEMENTS: &[&str] = &[
    "div", "span", "p", "br", "hr", "b", "i", "em", "strong", "small", "big", "sub", "sup", "u", "s", "strike", "del", "ins", "mark", "abbr", "cite", "q",
    "code", "kbd", "samp", "var", "pre", "tt", "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "td", "th", "figure", "figcaption",
    "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "header", "footer", "center", "font", "wbr", "ruby",
    "rt", "rp", "bdi", "bdo", "time", "address",
    "svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath", "title", "desc",
    "marker", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "foreignobject",
    "math", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "mstyle", "merror", "mpadded",
    "mphantom", "mfenced", "menclose", "munder", "mover", "munderover", "mmultiscripts", "mprescripts", "none", "mtable", "mtr", "mtd", "mlabeledtr", "semantics",
];

/// Elements left out with all they hold: what runs or fetches, forms, and markup in other
/// languages (MathML's `annotation-xml` can hold HTML).
const DROPPED: &[&str] = &[
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "audio", "video", "source", "track", "picture", "noscript", "template",
    "canvas", "textarea", "select", "input", "meta", "link", "base", "head", "image", "feimage", "animate", "set", "animatemotion", "animatetransform",
    "discard", "annotation", "annotation-xml",
];

/// Attributes kept, by their lower-case names: layout, geometry, how lines and text are
/// drawn. Not faces or colours as such (the reader's), nor anything with an address but
/// `href` to a place in the block itself.
const ATTRIBUTES: &[&str] = &[
    "class", "id", "lang", "dir", "title", "role", "style",
    "colspan", "rowspan", "span", "align", "valign", "width", "height", "border", "cellpadding", "cellspacing", "frame", "rules", "headers", "scope",
    "abbr", "start", "reversed", "type", "value", "nowrap",
    "viewbox", "preserveaspectratio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points", "pathlength",
    "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
    "stroke-dashoffset", "stroke-miterlimit", "stroke-opacity", "opacity", "clip-rule", "clip-path", "mask", "marker-start", "marker-mid",
    "marker-end", "markerwidth", "markerheight", "markerunits", "refx", "refy", "orient", "offset", "stop-color", "stop-opacity", "gradientunits",
    "gradienttransform", "spreadmethod", "patternunits", "patterncontentunits", "patterntransform", "maskunits", "maskcontentunits",
    "clippathunits", "font-size", "font-weight", "font-style", "font-variant", "text-anchor", "text-decoration", "dominant-baseline",
    "alignment-baseline", "baseline-shift", "dx", "dy", "rotate", "textlength", "lengthadjust", "startoffset", "method", "spacing", "side",
    "letter-spacing", "word-spacing", "writing-mode", "visibility", "display", "overflow", "vector-effect", "shape-rendering", "text-rendering", "href",
    "displaystyle", "scriptlevel", "mathvariant", "mathsize", "fence", "separator", "stretchy", "symmetric", "largeop", "movablelimits", "accent",
    "accentunder", "lspace", "rspace", "linethickness", "open", "close", "separators", "notation", "columnalign", "rowalign", "columnspacing",
    "rowspacing", "columnlines", "rowlines", "framespacing", "equalrows", "equalcolumns", "minsize", "maxsize", "depth", "voffset", "bevelled",
    "numalign", "denomalign", "form",
];

/// A value that would fetch: a `url()` anywhere but to a place in the block (`url(#id)`),
/// the functions that take an address without one, or escapes that could spell either.
fn fetches(v: &str) -> bool {
    let v = v.to_ascii_lowercase();
    v.contains('\\')
        || ["image-set(", "image(", "element(", "cross-fade(", "paint(", "expression("].iter().any(|f| v.contains(f))
        || v.match_indices("url(").any(|(i, _)| !v[i + 4..].trim_start_matches([' ', '"', '\'']).starts_with('#'))
}

/// A declaration made safe to draw on any paper: none for faces, colours, backgrounds,
/// positions fixed to the page or anything that fetches; a border's colour follows the ink.
fn declaration(k: &str, v: &str) -> Option<String> {
    let k = k.trim().to_ascii_lowercase();
    let v = v.trim();
    if k.is_empty() || k.starts_with("font-family") || k == "color" || k.starts_with("background") || k == "position" || k.starts_with('-') || fetches(v) {
        return None;
    }
    if k.starts_with("border") {
        let v = v.split_whitespace().map(|w| if w.starts_with('#') || w.starts_with("rgb") || is_colour_name(w) { "currentColor" } else { w }).collect::<Vec<_>>().join(" ");
        return Some(format!("{k}: {v}"));
    }
    Some(format!("{k}: {v}"))
}

fn declarations(decls: &str) -> Vec<String> {
    decls.split(';').filter_map(|d| d.split_once(':').and_then(|(k, v)| declaration(k, v))).collect()
}

fn esc(s: &str, attr: bool) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' if attr => o.push_str("&quot;"),
            '\u{a0}' => o.push_str("&#160;"),
            _ => o.push(c),
        }
    }
    o
}

/// The element as XHTML: well-formed, namespaces where SVG and MathML begin, only what
/// draws (`ELEMENTS`, `ATTRIBUTES`); images as their descriptions.
pub(crate) fn xhtml(e: &ElementRef) -> String {
    let mut out = String::new();
    write(**e, &mut out, "");
    out
}

fn write(n: NodeRef<Node>, out: &mut String, ns: &str) {
    match n.value() {
        Node::Text(t) => out.push_str(&esc(t, false)),
        Node::Element(el) => {
            let name = el.name().to_ascii_lowercase();
            if name == "img" {
                if let Some(alt) = el.attr("alt").filter(|a| !a.trim().is_empty()) {
                    out.push_str(&format!("<span>{}</span>", esc(alt, false)));
                }
                return;
            }
            if DROPPED.contains(&name.as_str()) {
                return;
            }
            if !ELEMENTS.contains(&name.as_str()) {
                for c in n.children() {
                    write(c, out, ns);
                }
                return;
            }
            // (SVG's own names keep their case: viewBox, linearGradient)
            let tag = el.name().to_string();
            let own_ns = match name.as_str() {
                "svg" if ns != "svg" => Some(("svg", "http://www.w3.org/2000/svg")),
                "math" if ns != "math" => Some(("math", "http://www.w3.org/1998/Math/MathML")),
                _ => None,
            };
            out.push('<');
            out.push_str(&tag);
            if let Some((_, uri)) = own_ns {
                out.push_str(&format!(" xmlns=\"{uri}\""));
            }
            // (an attribute's local name: `xlink:href` arrives as `href`, written as SVG 2 has it)
            for (k, v) in el.attrs() {
                let kl = k.to_ascii_lowercase();
                // (a style goes by its declarations: what fetches leaves, the rest stays)
                if !ATTRIBUTES.contains(&kl.as_str()) || kl == "href" && !v.starts_with('#') || kl != "style" && fetches(v) {
                    continue;
                }
                let v = if kl == "style" { declarations(v).join("; ") } else { v.to_string() };
                if kl == "style" && v.is_empty() {
                    continue;
                }
                out.push_str(&format!(" {k}=\"{}\"", esc(&v, true)));
            }
            let child_ns = own_ns.map(|(n, _)| n).unwrap_or(if name == "foreignobject" { "" } else { ns });
            if VOID.contains(&name.as_str()) && ns.is_empty() {
                out.push_str("/>");
                return;
            }
            out.push('>');
            for c in n.children() {
                write(c, out, child_ns);
            }
            out.push_str(&format!("</{tag}>"));
        }
        _ => {}
    }
}

/// The publisher's rules that apply inside `e`, made safe to draw on any paper: no
/// faces, colours, backgrounds, positions fixed to the page or links out; a border's
/// colour follows the ink.
pub(crate) fn styles_for(e: &ElementRef, rules: &[(String, String)]) -> String {
    let inside: Vec<ElementRef> = std::iter::once(*e).chain(e.descendent_elements()).collect();
    let mut out = String::new();
    for (sel, decls) in rules {
        // (an escape could spell what `fetches` looks for)
        let Ok(s) = Selector::parse(sel).ok().filter(|_| !sel.contains('\\')).ok_or(()) else { continue };
        if !inside.iter().any(|x| s.matches(x)) {
            continue;
        }
        let kept = declarations(decls);
        if !kept.is_empty() {
            out.push_str(&format!("{sel} {{ {} }}\n", kept.join("; ")));
        }
    }
    out
}

fn is_colour_name(w: &str) -> bool {
    matches!(w.to_ascii_lowercase().trim_end_matches([';', ',']), "black" | "white" | "gray" | "grey" | "silver" | "red" | "blue" | "green" | "navy" | "maroon" | "darkgray" | "darkgrey" | "lightgray" | "lightgrey" | "dimgray" | "dimgrey")
}

/// A rich block as stored: the element and its styles, in one XHTML fragment.
pub(crate) fn fragment(e: &ElementRef, rules: &[(String, String)]) -> String {
    let css = styles_for(e, rules);
    format!("<div class=\"typeset-rich\"><style>{}</style>{}</div>", esc(&css, false).replace("&gt;", ">"), xhtml(e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use scraper::Html;

    fn first<'a>(d: &'a Html, sel: &str) -> ElementRef<'a> {
        d.select(&Selector::parse(sel).unwrap()).next().unwrap()
    }

    #[test]
    fn a_genealogy_table_is_a_drawing_a_price_list_is_not() {
        let tree = Html::parse_document(&format!(
            "<table class=\"g\">{}</table>",
            "<tr><td></td><td>Edward III</td><td></td></tr><tr><td class=\"br\"></td><td></td><td class=\"bl\"></td></tr><tr><td>Lionel</td><td></td><td>John</td></tr><tr><td>│</td><td></td><td>│</td></tr>"
        ));
        assert!(is_diagram_table(&first(&tree, "table")));
        let data = Html::parse_document(&format!("<table>{}</table>", "<tr><td>Bread</td><td>2d</td><td>daily</td></tr>".repeat(5)));
        assert!(!is_diagram_table(&first(&data, "table")));
    }

    #[test]
    fn written_out_well_formed_with_its_styles_made_safe() {
        let d = Html::parse_document(r#"<table class="g" onclick="x()"><tr><td class="br">Edward<br>III &amp; heirs<img src="a.png" alt="crest"></td></tr></table><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>"#);
        let x = xhtml(&first(&d, "table"));
        assert!(!x.contains("onclick") && !x.contains("a.png"));
        assert!(x.contains("Edward<br/>III &amp; heirs<span>crest</span>"), "{x}");
        let s = xhtml(&first(&d, "svg"));
        assert!(s.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">"), "{s}");
        let css = styles_for(&first(&d, "table"), &[(".br".into(), "border-right: 1px solid #000; color: red; font-family: Garamond".into()), (".other".into(), "border: 1px solid black".into())]);
        assert_eq!(css, ".br { border-right: 1px solid currentColor }\n");
    }

    #[test]
    fn nothing_that_runs_fetches_or_goes_anywhere_survives() {
        let d = Html::parse_document(r##"<div>
          <svg viewBox="0 0 10 10"><a href="javascript:x()"><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="onmouseover" to="alert(1)"/><text x="1" y="5" style="fill: red; background: url(https://t.example/p.png)">A</text></a>
            <use xlink:href="#p"/><use href="https://t.example/s.svg#p"/><rect fill="url(#g)" stroke="url(https://t.example/x)" width="2" height="2"/><image href="https://t.example/i.png"/>
            <foreignObject><iframe src="https://t.example"></iframe><p onclick="x()">B</p></foreignObject></svg>
          <form action="https://t.example"><button formaction="javascript:x()">C</button></form><meta http-equiv="refresh" content="0;url=https://t.example"><link rel="stylesheet" href="https://t.example/s.css"><object data="https://t.example"></object><embed src="https://t.example">
          <table background="https://t.example/b.png" style="border: 1px solid; background-image: url(https://t.example/b.png); width: u\72l(https://t.example)"><tr><td>D</td></tr></table>
          <math><mi>x</mi><annotation-xml encoding="text/html"><img src=x onerror="alert(1)"></annotation-xml></math></div>"##);
        let x = xhtml(&first(&d, "div"));
        for bad in ["javascript", "t.example", "animate", "<set", "onclick", "onmouseover", "formaction", "<form", "<button", "<meta", "<link", "<object", "<embed", "<iframe", "<image", "annotation", "background", "\\", "<a"] {
            assert!(!x.contains(bad), "{bad} in {x}");
        }
        // what draws stays: text, shapes and their local references, the table's border
        for good in [r#"style="fill: red""#, ">A</text>", r##"<use href="#p">"##, r##"fill="url(#g)""##, "<p>B</p>", r#"style="border: 1px solid""#, "<td>D</td>", "<mi>x</mi>"] {
            assert!(x.contains(good), "{good} not in {x}");
        }
        // a form's words stay, as words
        assert!(x.split_whitespace().any(|w| w == "C"), "{x}");
        // and the publisher's rules likewise
        let css = styles_for(&first(&d, "table"), &[("table".into(), "border: 1px solid; list-style: image-set(\"https://t.example/i.png\" 1x); width: 4em".into())]);
        assert_eq!(css, "table { border: 1px solid; width: 4em }\n");
    }
}
