//! What the importer's tests share: a book made to order.
use std::io::Write;

/// A minimal EPUB of one chapter (a page of text, then `body`) under `heading`, with a style
/// sheet the chapter links.
pub fn epub_full(title: &str, heading: &str, body: &str, css: Option<&str>) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    let mut put = |name: &str, s: &str| {
        z.start_file(name, o).unwrap();
        z.write_all(s.as_bytes()).unwrap();
    };
    put("mimetype", "application/epub+zip");
    put("META-INF/container.xml", r#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#);
    put("OEBPS/content.opf", &format!(r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">t</dc:identifier><dc:title>{title}</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="s" href="css/style.css" media-type="text/css"/></manifest><spine><itemref idref="c"/></spine></package>"#));
    // (with a page of text: the importer leaves out sections too short to be chapters)
    let page = "<p>".to_string() + &"Words of a chapter long enough to be one. ".repeat(60) + "</p>";
    put("OEBPS/css/style.css", css.unwrap_or(""));
    put("OEBPS/c.xhtml", &format!(r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title><link rel="stylesheet" type="text/css" href="css/style.css"/></head><body><h1>{heading}</h1>{page}{body}</body></html>"#));
    z.finish().unwrap().into_inner()
}
