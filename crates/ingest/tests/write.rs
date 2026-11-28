//! Books written out as EPUB (src/write.rs) read back as the same books: a sample of some
//! chapters, a book of hard tables, a Word manuscript.
use typeset_model::{Kind, SectionKind, Target};

fn file(rel: &str) -> Vec<u8> {
    std::fs::read(format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

/// Each section's blocks as (kind, text): what must survive the trip.
fn blocks(b: &typeset_model::Book) -> Vec<Vec<(Kind, String)>> {
    b.sections.iter().map(|s| s.blocks.iter().map(|x| (x.kind, x.text.clone())).collect()).collect()
}

#[test]
fn a_sample_of_two_chapters_reads_back_as_those_chapters() {
    let src = file("assets/sample.epub");
    let whole = typeset_ingest::any(&src, "meditations.epub").unwrap();
    let out = typeset_ingest::write::sample(&src, "meditations.epub", 2, 3).unwrap();
    let back = typeset_ingest::epub(&out).unwrap();
    assert_eq!(back.meta.title, whole.meta.title);
    assert_eq!(back.meta.author, whole.meta.author);
    assert!(back.sections.iter().all(|s| s.kind == SectionKind::Chapter));
    let labels: Vec<_> = back.sections.iter().map(|s| s.label.as_str()).collect();
    assert_eq!(labels, ["Book II", "Book III"]);
    let chapters: Vec<_> = whole.sections.iter().filter(|s| s.kind == SectionKind::Chapter).collect();
    let want: Vec<Vec<(Kind, String)>> =
        chapters[1..3].iter().map(|s| s.blocks.iter().map(|x| (x.kind, x.text.clone())).collect()).collect();
    assert_eq!(blocks(&back), want);
    // its footnotes came with it, linked from the text
    let linked = back
        .sections
        .iter()
        .flat_map(|s| &s.blocks)
        .flat_map(|b| &b.links)
        .filter(|l| matches!(l.to, Target::Note(_)))
        .count();
    assert!(linked > 10 && back.notes.len() >= linked, "{linked} links, {} notes", back.notes.len());
    // and italic, where the book has it
    let styled =
        |b: &typeset_model::Book| b.sections.iter().flat_map(|s| &s.blocks).map(|x| x.runs.len()).sum::<usize>();
    assert!(styled(&back) > 0);
}

#[test]
fn tables_and_a_word_manuscript_read_back_the_same() {
    for (rel, name) in
        [("bench/fixtures/tables.epub", "tables.epub"), ("bench/fixtures/manuscript.docx", "manuscript.docx")]
    {
        let book = typeset_ingest::any(&file(rel), name).unwrap();
        let back = typeset_ingest::epub(&typeset_ingest::write::epub(&book).unwrap()).unwrap();
        assert_eq!(blocks(&back), blocks(&book), "{rel}");
        let shapes = |b: &typeset_model::Book| {
            b.sections.iter().flat_map(|s| &s.blocks).filter_map(|x| x.table.clone()).collect::<Vec<_>>()
        };
        assert_eq!(shapes(&back), shapes(&book), "{rel}");
    }
}
