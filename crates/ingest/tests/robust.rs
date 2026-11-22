//! Files that once crashed the importer (a crash on the web stops the engine), made small.
use std::io::Write;

/// A minimal EPUB of one chapter with this body.
fn epub_of(body: &str) -> Vec<u8> {
    epub_titled("T", "One", body)
}

/// The same, with the book's title and the chapter's heading.
fn epub_titled(title: &str, heading: &str, body: &str) -> Vec<u8> {
    epub_full(title, heading, body, None)
}

/// The same, with a style sheet the chapter links.
fn epub_full(title: &str, heading: &str, body: &str, css: Option<&str>) -> Vec<u8> {
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

/// Every run and link of every block lies on the block's own characters.
fn sound(b: &typeset_model::Book) {
    for blk in b.sections.iter().flat_map(|s| &s.blocks) {
        let ok = |a: u32, z: u32| a <= z && z as usize <= blk.text.len() && blk.text.is_char_boundary(a as usize) && blk.text.is_char_boundary(z as usize);
        for r in &blk.runs {
            assert!(ok(r.start, r.end), "run {r:?} in {:?}", blk.text);
        }
        for l in &blk.links {
            assert!(ok(l.start, l.end), "link {}..{} in {:?}", l.start, l.end, blk.text);
        }
    }
}

#[test]
fn a_table_cell_with_line_breaks_keeps_its_links_and_styles_in_place() {
    // (Gutenberg's illustrated books: "Full Size<br/>&#160;&#160; <a>Original Archive</a>")
    let body = r##"<p>Text <a href="#n">1</a>.</p><table><tr><td><b>Full</b><br/>Size&#160;&#160;<a href="#x">Original</a></td><td>B<br/><i>two</i></td></tr></table><p id="x">Target.</p><p id="n">Note.</p>"##;
    let b = typeset_ingest::any(&epub_of(body), "t.epub").unwrap();
    sound(&b);
    let t = b.sections.iter().flat_map(|s| &s.blocks).find(|b| b.kind == typeset_model::Kind::Table).unwrap();
    assert_eq!(t.text, "Full\u{2028}Size\u{a0}\u{a0}Original\tB\u{2028}two");
    let l = &t.links[0];
    assert_eq!(&t.text[l.start as usize..l.end as usize], "Original");
    let it = t.runs.iter().find(|r| r.style & typeset_model::style::ITALIC != 0).unwrap();
    assert_eq!(&t.text[it.start as usize..it.end as usize], "two");
}

#[test]
fn a_story_printed_whole_under_the_books_title_is_the_book() {
    // (Gutenberg's "The Yellow Wallpaper": one section, headed with the title; it was taken
    // for a title page and left out, and the book had "no readable text")
    let story = "<hr/>".to_string() + &"<p>It is very seldom that mere ordinary people like John and myself secure ancestral halls for the summer.</p>".repeat(60);
    let b = typeset_ingest::any(&epub_titled("The Yellow Wallpaper", "The Yellow Wallpaper", &story), "t.epub").unwrap();
    assert_eq!(b.sections.len(), 1);
    assert_eq!(b.sections[0].kind, typeset_model::SectionKind::Chapter);
    assert_eq!(b.sections[0].blocks[0].kind, typeset_model::Kind::P);
}

#[test]
fn a_document_of_headings_only_reads_them_as_text() {
    // (Word files where every line is styled "Title": as chapters they were all empty)
    let b = typeset_ingest::any(b"# Sample Word Document\n\n# This is a sample document having bookmarks.\n\n# And a third line.\n", "notes.md").unwrap();
    let text: Vec<&str> = b.sections.iter().flat_map(|s| &s.blocks).map(|b| b.text.as_str()).collect();
    assert_eq!(text, ["Sample Word Document", "This is a sample document having bookmarks.", "And a third line."]);
}

#[test]
fn files_that_are_not_books_say_what_they_are() {
    let err = |b: &[u8], n: &str| typeset_ingest::any(b, n).err().map(|e| e.to_string()).unwrap_or_default();
    assert!(err(b"%PDF-1.7\n\x00\x01binary", "a.pdf").starts_with("it is a PDF"));
    assert!(err(b"\xff\xd8\xff\xe0\x00\x10JFIF", "IMG_0001.jpg").starts_with("it is an image"));
    assert!(err(b"\xff\xd8\xff\xe0\x00\x10JFIF", "book.epub").starts_with("it is an image"));
    let mut mobi = vec![0u8; 80];
    mobi[60..68].copy_from_slice(b"BOOKMOBI");
    assert!(err(&mobi, "b.azw3").starts_with("it is a Kindle book"));
    assert!(err(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1\x00\x00", "draft.doc").starts_with("it is an older Word document"));
    assert!(err(b"{\\rtf1\\ansi hello}", "draft.rtf").starts_with("it is in Rich Text Format"));
    // bytes that are no text at all
    let noise: Vec<u8> = (0..4000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    assert!(err(&noise, "x.bin").starts_with("it is not a book"));
}

#[test]
fn old_text_files_and_utf16_ones_read_as_written() {
    let text = |b: &[u8]| typeset_ingest::any(b, "t.txt").unwrap().sections[0].blocks[0].text.clone();
    // Windows-1252: curly quotes, a dash, an e acute
    assert_eq!(text(b"\x93Caf\xe9\x94 \x97 open."), "\u{201c}Café\u{201d} \u{2014} open.");
    let mut u16le = vec![0xff, 0xfe];
    u16le.extend("Hello, world.".encode_utf16().flat_map(u16::to_le_bytes));
    assert_eq!(text(&u16le), "Hello, world.");
    assert_eq!(text(b"\xef\xbb\xbfWith a mark."), "With a mark.");
}

#[test]
fn the_publishers_styles_hide_what_they_hide_and_style_what_they_style() {
    // (an InDesign-style book: a layout note hidden by its class, styles by class, a
    // Kindle-only heading, a page number hidden inline)
    let css = r#"
        .layout { display: none }
        span.it, .emph { font-style: italic }
        .bd { font-weight: 700 }
        .sc { font-variant: small-caps }
        p.epigraph { font-style: italic }
        @media amzn-kf8 { .kindle { display: none } }
        @media print { .screen-only { display: none } }
    "#;
    let body = r#"<p class="layout">LAYOUT 2</p>
        <p>He said <span class="it">never</span> and <span class="bd">always</span>, in <span class="sc">Rome</span>.<span style="display:none">p. 12</span></p>
        <p class="epigraph">All is <span style="font-style: normal">opinion</span>.</p>
        <p class="kindle">Shown here.</p><p class="screen-only">Also shown.</p>"#;
    let b = typeset_ingest::any(&epub_full("T", "One", body, Some(css)), "t.epub").unwrap();
    let text: Vec<&str> = b.sections.iter().flat_map(|s| &s.blocks).map(|b| b.text.as_str()).collect();
    assert!(!text.iter().any(|t| t.contains("LAYOUT")), "{text:?}");
    let said = b.sections.iter().flat_map(|s| &s.blocks).find(|b| b.text.starts_with("He said")).unwrap();
    assert_eq!(said.text, "He said never and always, in Rome.");
    let styled = |w: &str, bit: u8| {
        let at = said.text.find(w).unwrap() as u32;
        said.runs.iter().any(|r| r.start <= at && r.end >= at + w.len() as u32 && r.style & bit != 0)
    };
    assert!(styled("never", typeset_model::style::ITALIC));
    assert!(styled("always", typeset_model::style::BOLD));
    assert!(styled("Rome", typeset_model::style::SMALLCAPS));
    let epi = b.sections.iter().flat_map(|s| &s.blocks).find(|b| b.text.starts_with("All is")).unwrap();
    // the paragraph is italic, the word set upright within it is not
    let it: String = epi.runs.iter().filter(|r| r.style & typeset_model::style::ITALIC != 0).map(|r| &epi.text[r.start as usize..r.end as usize]).collect();
    assert!(it.starts_with("All is") && !it.contains("opinion"), "{it:?}");
    assert!(text.contains(&"Shown here.") && text.contains(&"Also shown."));
}

#[test]
fn what_the_press_cannot_set_is_kept_as_drawn_and_tables_of_data_stay_tables() {
    let path = format!("{}/../../bench/fixtures/rich.epub", env!("CARGO_MANIFEST_DIR"));
    let Ok(bytes) = std::fs::read(&path) else { return };
    let b = typeset_ingest::any(&bytes, "rich.epub").unwrap();
    let blocks: Vec<_> = b.sections.iter().flat_map(|s| &s.blocks).collect();
    let rich: Vec<_> = blocks.iter().filter_map(|x| x.image).map(|i| &b.images[i as usize]).filter(|i| i.mime == typeset_model::RICH).collect();
    assert_eq!(rich.len(), 3, "the genealogy, the figure, the formula");
    let tree = String::from_utf8(rich[0].bytes.clone()).unwrap();
    // well-formed, its tree's lines from the style sheet, their colour the ink's, no faces
    assert!(tree.contains("<table class=\"genealogy\">") && tree.contains("td.br { border-right: 1px solid currentColor;"), "{tree}");
    assert!(!tree.contains("Garamond") && !tree.contains("#333"));
    assert!(rich[0].alt.contains("Edward III") && rich[0].alt.contains("John of Gaunt"));
    assert!(String::from_utf8(rich[1].bytes.clone()).unwrap().contains("<svg xmlns=\"http://www.w3.org/2000/svg\""));
    assert!(String::from_utf8(rich[2].bytes.clone()).unwrap().contains("<math xmlns=\"http://www.w3.org/1998/Math/MathML\""));
    assert_eq!((rich[0].w, rich[0].h), (0, 0), "measured by the reader");
    assert!(blocks.iter().any(|x| x.kind == typeset_model::Kind::Table && x.text.starts_with("Reign\tBegan")));
}

#[test]
fn the_publishers_alignment_centres_and_sets_right_without_adding_italic() {
    let css = ".c { text-align: center } .r { text-align: right } p.centre-ish { text-align: left }";
    let body = r#"<p class="c">To my brother</p><p class="r">London, 1910.</p><p class="center centre-ish">Not centred: the sheet says left.</p><p class="c"><i>In italic</i> as written.</p>"#;
    let b = typeset_ingest::any(&epub_full("T", "One", body, Some(css)), "t.epub").unwrap();
    let find = |t: &str| b.sections.iter().flat_map(|s| &s.blocks).find(|x| x.text.starts_with(t)).unwrap();
    assert_eq!(find("To my brother").kind, typeset_model::Kind::Center);
    assert!(find("To my brother").runs.iter().all(|r| r.style & typeset_model::style::ITALIC == 0), "centred, upright as written");
    assert_eq!(find("London").kind, typeset_model::Kind::Attrib);
    assert_eq!(find("Not centred").kind, typeset_model::Kind::P);
    let it = find("In italic");
    assert_eq!(it.kind, typeset_model::Kind::Center);
    assert!(it.runs.iter().any(|r| r.style & typeset_model::style::ITALIC != 0 && &it.text[r.start as usize..r.end as usize] == "In italic"));
}
