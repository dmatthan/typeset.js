//! Readers' notes put into the writer's Word file as Word comments (src/annotate.rs): found
//! by their words, placed on exactly those words, the text left as it was.
use std::io::Read;
use typeset_ingest::annotate::{Comment, annotate};

fn fixture() -> Vec<u8> {
    std::fs::read(format!("{}/../../bench/fixtures/manuscript.docx", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn part(docx: &[u8], name: &str) -> String {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(docx)).unwrap();
    let mut s = String::new();
    z.by_name(name).unwrap().read_to_string(&mut s).unwrap();
    s
}

/// A note on `words` of the book's text, with what the reader saw either side.
fn note_on(text: &str, words: &str, author: &str, said: &str) -> Comment {
    let i = text.find(words).unwrap_or_else(|| panic!("{words:?} not in {text:?}"));
    let before: String = text[..i].chars().rev().take(32).collect::<Vec<_>>().into_iter().rev().collect();
    let after: String = text[i + words.len()..].chars().take(32).collect();
    Comment { quote: words.into(), prefix: before, suffix: after, author: author.into(), text: said.into(), date: "2026-10-15T12:00:00Z".into() }
}

#[test]
fn notes_become_word_comments_on_their_words() {
    let src = fixture();
    let book = typeset_ingest::docx(&src, "manuscript.docx").unwrap();
    let blocks = &book.sections[0].blocks;
    let (a, b) = (&blocks[0].text, &blocks[3].text);
    // across a formatting change (the italic "forty years"), at a paragraph's start, within one run
    let wa: String = a.chars().take(24).collect();
    let mid = b.split_whitespace().skip(3).take(4).collect::<Vec<_>>().join(" ");
    let notes = vec![
        note_on(a, a.split("forty years").next().unwrap().split_whitespace().last().map(|w| &a[a.find(w).unwrap()..a.find("forty years").unwrap() + 11]).unwrap(), "Ann", "The number matters here"),
        note_on(a, &wa, "Tomas", "A strong opening\nwith a second line"),
        note_on(b, &mid, "Ines & co <3>", "Marked"),
        Comment { quote: "words that are nowhere in this book".into(), author: "Ann".into(), text: "lost".into(), ..Default::default() },
    ];
    let out = annotate(&src, &notes).unwrap();
    assert_eq!(out.placed, 3);
    // (TYPESET_DUMP=dir: the annotated file, to open in Word or LibreOffice)
    if let Ok(d) = std::env::var("TYPESET_DUMP") { std::fs::write(format!("{d}/annotated.docx"), &out.bytes).unwrap(); }
    assert_eq!(out.unplaced, vec![3]);

    // the comments, by their readers, escaped
    let comments = part(&out.bytes, "word/comments.xml");
    assert!(comments.contains("w:author=\"Ann\"") && comments.contains("w:author=\"Tomas\"") && comments.contains("w:author=\"Ines &amp; co &lt;3&gt;\""));
    assert!(comments.contains(">A strong opening</w:t>") && comments.contains(">with a second line</w:t>"));
    let doc = part(&out.bytes, "word/document.xml");
    for id in 0..3 {
        assert_eq!(doc.matches(&format!("<w:commentRangeStart w:id=\"{id}\"/>")).count(), 1);
        assert_eq!(doc.matches(&format!("<w:commentReference w:id=\"{id}\"/>")).count(), 1);
    }
    assert!(part(&out.bytes, "word/_rels/document.xml.rels").contains("relationships/comments"));
    assert!(part(&out.bytes, "[Content_Types].xml").contains("/word/comments.xml"));

    // the text is exactly as it was: the same book read from the annotated file
    let again = typeset_ingest::docx(&out.bytes, "manuscript.docx").unwrap();
    let texts = |b: &typeset_model::Book| b.sections.iter().flat_map(|s| s.blocks.iter().map(|x| (x.text.clone(), x.runs.clone()))).collect::<Vec<_>>();
    assert_eq!(texts(&again), texts(&book));

    // each comment spans its words: the text between its marks is the quote
    let between = |id: usize| {
        let s = doc.find(&format!("<w:commentRangeStart w:id=\"{id}\"/>")).unwrap();
        let e = doc.find(&format!("<w:commentRangeEnd w:id=\"{id}\"/>")).unwrap();
        let mut r = quick_xml::Reader::from_str(&doc[s..e]);
        let mut t = String::new();
        let mut in_t = false;
        loop {
            match r.read_event() {
                Ok(quick_xml::events::Event::Start(x)) if x.name().as_ref() == b"w:t" => in_t = true,
                Ok(quick_xml::events::Event::End(x)) if x.name().as_ref() == b"w:t" => in_t = false,
                Ok(quick_xml::events::Event::Text(x)) if in_t => t.push_str(&x.xml_content().unwrap()),
                Ok(quick_xml::events::Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
        t
    };
    for (id, n) in notes[..3].iter().enumerate() {
        assert_eq!(between(id), n.quote, "comment {id}");
    }

    // a second round, onto the annotated file: ids after the first ones
    let more = annotate(&out.bytes, &notes[..1]).unwrap();
    assert!(part(&more.bytes, "word/document.xml").contains("<w:commentRangeStart w:id=\"3\"/>"));
    assert_eq!(part(&more.bytes, "word/comments.xml").matches("<w:comment ").count(), 4);
}
