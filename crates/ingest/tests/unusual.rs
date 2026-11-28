//! Books of kinds a reader meets less often (bench/fixtures/unusual.py makes fuller ones):
//! writing without spaces, pictures only, locked by a shop.
use std::io::Write;
use typeset_model::Kind;

/// A PNG's header, 600 × 800 (the importer reads a picture's size, and leaves out one
/// smaller than 24 pixels as a spacer; nothing here draws it).
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\x02\x58\0\0\x03\x20\x08\x06\0\0\0\x1f\x15\xc4\x89\0\0\0\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\0\x05\0\x01\xff\x89\x99=\x1d\0\0\0\0IEND\xaeB`\x82";

/// An EPUB of these chapters (file body, without the html around it), and other files.
fn epub(lang: &str, chapters: &[String], extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default();
    let mut put = |name: &str, b: &[u8]| {
        z.start_file(name, o).unwrap();
        z.write_all(b).unwrap();
    };
    put("mimetype", b"application/epub+zip");
    put("META-INF/container.xml", br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#);
    let items: String = (0..chapters.len())
        .map(|i| format!(r#"<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>"#))
        .collect();
    let refs: String = (0..chapters.len()).map(|i| format!(r#"<itemref idref="c{i}"/>"#)).collect();
    put("OEBPS/content.opf", format!(r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">t</dc:identifier><dc:title>Book</dc:title><dc:language>{lang}</dc:language></metadata><manifest>{items}<item id="p" href="p.png" media-type="image/png"/></manifest><spine>{refs}</spine></package>"#).as_bytes());
    for (i, c) in chapters.iter().enumerate() {
        put(&format!("OEBPS/c{i}.xhtml"), format!(r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" lang="{lang}"><head><title>T</title></head><body>{c}</body></html>"#).as_bytes());
    }
    put("OEBPS/p.png", PNG);
    for (name, b) in extra {
        put(name, b);
    }
    z.finish().unwrap().into_inner()
}

#[test]
fn a_chinese_chapter_of_a_few_paragraphs_is_a_chapter() {
    // (counted by spaces, each paragraph was one word, and a chapter of fewer than
    // fifteen paragraphs was taken for a title page)
    let p = "<p>子曰：「學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？人不知而不慍，不亦君子乎？」</p>";
    let ch: Vec<String> = (1..=3).map(|i| format!("<h1>學而第{i}</h1>{}", p.repeat(3))).collect();
    let b = typeset_ingest::epub(&epub("zh-Hant", &ch, &[])).unwrap();
    assert_eq!(b.sections.len(), 3);
    assert!(b.words() > 90, "{} words", b.words());
}

#[test]
fn a_book_of_pictures_keeps_its_pages() {
    let ch: Vec<String> = (0..6).map(|_| r#"<div><img src="p.png" alt=""/></div>"#.to_string()).collect();
    let b = typeset_ingest::epub(&epub("en", &ch, &[])).unwrap();
    // pages with no names of their own go on from the first
    assert_eq!(b.sections.len(), 1);
    assert_eq!(b.sections[0].blocks.iter().filter(|b| b.kind == Kind::Image).count(), 6);
}

#[test]
fn a_picture_on_a_title_page_is_still_left_out_of_a_book_of_words() {
    let mut ch = vec![r#"<div><img src="p.png" alt=""/></div>"#.to_string()];
    ch.extend(
        (1..=2)
            .map(|i| format!("<h1>Chapter {i}</h1><p>{}</p>", "Words of a chapter long enough to be one. ".repeat(40))),
    );
    let b = typeset_ingest::epub(&epub("en", &ch, &[])).unwrap();
    assert_eq!(b.sections.len(), 2);
    assert!(b.sections.iter().flat_map(|s| &s.blocks).all(|b| b.kind != Kind::Image));
}

#[test]
fn a_book_locked_by_its_shop_says_so() {
    let ch = vec![format!("<h1>One</h1><p>{}</p>", "Ciphertext, as far as anyone can tell. ".repeat(40))];
    let adept = br#"<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><CipherData><CipherReference URI="OEBPS/c0.xhtml"/></CipherData></EncryptedData></encryption>"#;
    for extra in [&[("META-INF/encryption.xml", &adept[..])][..], &[("META-INF/sinf.xml", &b"<fairplay/>"[..])][..]] {
        let e = typeset_ingest::any(&epub("en", &ch, extra), "b.epub").unwrap_err().to_string();
        assert!(e.contains("DRM") && !e.contains("Volumen"), "{e}");
    }
    // fonts obfuscated for their licence are not a lock
    let fonts = br#"<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><enc:EncryptedData xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/f.ttf"/></enc:CipherData></enc:EncryptedData></encryption>"#;
    assert!(typeset_ingest::any(&epub("en", &ch, &[("META-INF/encryption.xml", fonts)]), "b.epub").is_ok());
}
