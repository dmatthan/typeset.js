//! Manuscripts as writers send them: Word (written by LibreOffice) and Markdown, the same
//! text (bench/fixtures/manuscript.py). Both come out as the same book.
use vol_model::{Kind, SectionKind, Target, style};

fn book(name: &str) -> vol_model::Book {
    let p = format!("{}/../../bench/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    vol_ingest::any(&std::fs::read(&p).unwrap(), &p).unwrap()
}

#[test]
fn word_and_markdown_manuscripts_become_the_same_book() {
    for name in ["manuscript.docx", "manuscript.md"] {
        let b = book(name);
        assert_eq!((b.meta.title.as_str(), b.meta.author.as_str()), ("The Lantern Keeper", "Ada Morrow"), "{name}");
        // the title is not a chapter; the two headings are
        assert_eq!(b.sections.len(), 2, "{name}");
        assert!(b.sections.iter().all(|s| s.kind == SectionKind::Chapter));
        assert_eq!((b.sections[0].label.as_str(), b.sections[0].title.as_str()), ("Chapter One", "The Harbour"), "{name}");
        let blocks = &b.sections[0].blocks;
        let kinds: Vec<Kind> = blocks.iter().map(|b| b.kind).collect();
        assert_eq!(kinds, [Kind::P, Kind::P, Kind::Q, Kind::P, Kind::Break, Kind::P], "{name}");
        // italic and bold runs where the writer put them
        let first = &blocks[0];
        assert!(first.runs.iter().any(|r| r.style & style::ITALIC != 0 && &first.text[r.start as usize..r.end as usize] == "forty years"), "{name}: {:?}", first.runs);
        assert!(blocks[1].runs.iter().any(|r| r.style & style::BOLD != 0), "{name}");
        // footnotes: linked markers, the notes' text
        assert_eq!(b.notes.len(), 2, "{name}");
        assert_eq!(b.notes[0].text, "Some say fifty; the harbour records were lost in the flood.", "{name}");
        assert!(matches!(first.links[0].to, Target::Note(0)));
        assert!(matches!(blocks[5].links[0].to, Target::Note(1)));
        // list items
        assert_eq!(b.sections[1].blocks.iter().filter(|b| b.kind == Kind::Li).count(), 2, "{name}");
    }
    // small capitals survive from Word (Markdown has none)
    let d = book("manuscript.docx");
    assert!(d.sections[0].blocks[5].runs.iter().any(|r| r.style & style::SMALLCAPS != 0));
}

#[test]
fn markdown_keeps_its_links_to_the_web_and_mail_and_nothing_else() {
    let md = "# One\n\nSee [the archive](https://example.org/a?b=1), <https://example.org/auto>, [write](mailto:a@example.org), [a script](javascript:alert(1)) and [a page](other.md).\n";
    let b = vol_ingest::any(md.as_bytes(), "post.md").unwrap();
    let p = &b.sections[0].blocks[0];
    let urls: Vec<(&str, &str)> = p.links.iter().filter_map(|l| match &l.to { Target::Url(u) => Some((&p.text[l.start as usize..l.end as usize], u.as_str())), _ => None }).collect();
    assert_eq!(urls, [("the archive", "https://example.org/a?b=1"), ("https://example.org/auto", "https://example.org/auto"), ("write", "mailto:a@example.org")]);
    // the others' words stay, as words
    assert!(p.text.contains("a script and a page."), "{}", p.text);
}
