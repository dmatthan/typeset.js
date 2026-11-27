//! A book's own structure, as an EPUB sets it (the book's styles, the browser's defaults
//! where it gives none), in the text's em; Word and Markdown say nothing of it, and the
//! reader's own rules set them.
//!
//! Its heads: their lines as they are, with their case, breaks and small capitals; each
//! line's size, and the space above and below. Above, only paddings: a head begins a page,
//! and a margin at a page's top is dropped (as a browser paginates, and as Apple Books'
//! Original shows Thursday: 1.8 em down, its 1.5 em of padding, not its 5.5 em with the
//! margins).
//!
//! Its paragraphs: the first line's indent and the space above (its top margin meeting the
//! bottom one of the block before, as a browser's do); and no opening in small capitals
//! the book did not ask for (the reader's house opening is Word's and Markdown's).
//!
//! And the leading its text is set in, where it sets one: the line-height most of its
//! paragraphs' text has (a theme may follow it, as Apple Books' Original does).
mod common;
use common::epub_full;
use typeset_model::{style, Book, Section};

fn book(name: &str) -> Book {
    let p = format!("{}/../../bench/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    typeset_ingest::any(&std::fs::read(&p).unwrap(), &p).unwrap()
}

fn chapter<'a>(b: &'a Book, title: &str) -> &'a Section {
    b.sections.iter().find(|s| s.title == title).unwrap_or_else(|| panic!("no chapter {title:?}"))
}

/// To a hundredth.
fn r(x: f32) -> f32 {
    (x * 100.0).round() / 100.0
}

/// A head's lines (text and size), and the space above and below.
fn head(s: &Section) -> (Vec<(&str, f32)>, f32, f32) {
    let h = s.head.as_ref().expect("a head");
    (h.lines.iter().map(|l| (l.block.text.as_str(), r(l.size))).collect(), r(h.above), r(h.below))
}

/// A block's indent and space above.
fn set(s: &Section, i: usize) -> Option<(f32, f32)> {
    s.blocks[i].set.map(|x| (r(x.indent), r(x.above)))
}

#[test]
fn a_gutenberg_head_keeps_its_lines_its_capitals_its_size_and_the_space_around_it() {
    let b = book("thursday.epub");
    // `h2 { font-size: 150%; margin: 2em 0 1em }` in a `div.chapter { margin-top: 4em }`,
    // and `h2 { padding-top: 1em }` from another sheet, each in its own em (the heading's
    // 1.5 of the text's): above, the padding alone; below, its margin
    assert_eq!(head(chapter(&b, "The Two Poets of Saffron Park")), (vec![("CHAPTER I.\nTHE TWO POETS OF SAFFRON PARK", 1.5)], 1.5, 1.5));
}

#[test]
fn a_standard_ebooks_hgroup_is_one_head_of_two_lines_in_small_capitals_and_not_text() {
    let b = book("artofwar.epub");
    let s = chapter(&b, "I: Laying Plans");
    // the ordinal an h2 (the browser's 1.5 em), the title a p made a smaller heading
    // (`hgroup > h2 + p { font-size: 1.17em }`); the group's margins 4.5 em (none above,
    // at a page's top; below, all of it)
    assert_eq!(head(s), (vec![("I", 1.5), ("Laying Plans168", 1.17)], 0.0, 4.5));
    // small capitals, as `h2, hgroup { font-variant: small-caps }` says
    for l in &s.head.as_ref().unwrap().lines {
        assert!(l.block.runs.iter().any(|r| r.style & style::SMALLCAPS != 0 && r.start == 0), "{:?}", l.block.text);
    }
    // and the title is not also the chapter's first paragraph
    assert!(!s.blocks[0].text.starts_with("Laying Plans"), "{:?}", s.blocks[0].text);
}

#[test]
fn a_head_keeps_its_case_where_the_title_made_from_it_could_not() {
    let b = book("beagle.epub");
    let s = b.sections.iter().find(|s| s.label == "Chapter I").unwrap();
    let text = &s.head.as_ref().unwrap().lines[0].block.text;
    assert!(text.contains("CAPE DE VERD") || text.contains("Cape de Verd"), "{text:?}");
}

#[test]
fn gutenberg_indents_every_paragraph_the_first_too_with_a_quarter_em_between() {
    let b = book("thursday.epub");
    let s = chapter(&b, "The Two Poets of Saffron Park");
    // `p { text-indent: 1em; margin: .25em 0 }`: the first under the head as the rest (its
    // space above the head's bottom margin, met, which the head's rows already hold)
    assert_eq!((set(s, 0), set(s, 1)), (Some((1.0, 1.5)), Some((1.0, 0.25))));
    // and it opens as the book wrote it, not in small capitals
    assert!(!s.blocks[0].runs.iter().any(|r| r.start == 0 && r.style & style::SMALLCAPS != 0), "{:?}", s.blocks[0].runs);
}

#[test]
fn standard_ebooks_set_the_first_after_a_head_flush() {
    let b = book("artofwar.epub");
    let s = chapter(&b, "I: Laying Plans");
    // `p { text-indent: 1em; margin: 0 }`, `hgroup + p { text-indent: 0 }` (the first's space
    // above the group's bottom margin, met)
    assert_eq!((set(s, 0), set(s, 1)), (Some((0.0, 4.5)), Some((1.0, 0.0))));
}

#[test]
fn word_and_markdown_have_neither_heads_nor_settings_and_open_in_small_capitals() {
    let md = b"# One\n\nThe first chapter's text, long enough to be one of its own.\n\nAnd a second paragraph.\n";
    let b = typeset_ingest::any(md, "x.md").unwrap();
    assert!(b.sections.iter().all(|s| s.head.is_none()));
    let s = b.sections.iter().find(|s| s.title == "One").unwrap();
    assert!(s.blocks.iter().all(|x| x.set.is_none()));
    assert!(s.blocks[0].runs.iter().any(|r| r.start == 0 && r.style & style::SMALLCAPS != 0));
}

#[test]
fn the_leading_most_of_the_text_is_set_in_is_the_books_own() {
    let leading = |css: &str, body: &str| typeset_ingest::any(&epub_full("T", "One", body, Some(css)), "x.epub").unwrap().leading;
    // as the body says it, as a paragraph does (a percentage, pixels at a browser's 16), as
    // the `font` shorthand does
    assert_eq!(leading("body { line-height: 1.5 }", ""), Some(1.5));
    assert_eq!(leading("p { line-height: 150% }", ""), Some(1.5));
    assert_eq!(leading("p { line-height: 24px }", ""), Some(1.5));
    assert_eq!(leading("body { font: 100%/1.4 Georgia, serif }", ""), Some(1.4));
    // the most text's: a short paragraph of its own says less
    assert_eq!(leading("body { line-height: 1.4 } .x { line-height: 2 }", "<p class=\"x\">A line apart.</p>"), Some(1.4));
    // none where the book says none, or the browser's own
    assert_eq!(leading("p { text-indent: 1em }", ""), None);
    assert_eq!(leading("body { line-height: normal }", ""), None);
    // nor where only a centred title page says one (Thursday's), not its text
    assert_eq!(book("thursday.epub").leading, None);
}

#[test]
fn a_head_keeps_its_alignment_as_the_book_sets_it_left_where_it_says_none() {
    // each line's: 0 at the start (the browser's own), 1 centred, 2 at the end
    let align = |b: &Book, title: &str| chapter(b, title).head.as_ref().unwrap().lines.iter().map(|l| l.align).collect::<Vec<_>>();
    // a small press's `h1 { text-align: left }`
    let small = book("original.epub");
    let s = small.sections.iter().find(|s| s.head.as_ref().is_some_and(|h| h.lines[0].block.text == "Chapter 1")).unwrap();
    assert_eq!(s.head.as_ref().unwrap().lines.iter().map(|l| l.align).collect::<Vec<_>>(), vec![0]);
    // Gutenberg's centred h2; Standard Ebooks' centred hgroup, both its lines
    assert_eq!(align(&book("thursday.epub"), "The Two Poets of Saffron Park"), vec![1]);
    assert_eq!(align(&book("artofwar.epub"), "I: Laying Plans"), vec![1, 1]);
}

#[test]
fn a_paragraph_the_book_sets_apart_from_its_justified_body_is_set_ragged() {
    let b = book("original.epub");
    let s = b.sections.iter().find(|s| s.head.as_ref().is_some_and(|h| h.lines[0].block.text == "Chapter 1")).unwrap();
    let ragged = |i: usize| s.blocks[i].set.map(|x| x.ragged);
    // the credit (`p.credit { text-align: left }` in a justified body): ragged; the text not
    let credit = s.blocks.iter().position(|x| x.text.starts_with("Set for the tests")).unwrap();
    assert_eq!(ragged(credit), Some(true));
    let text = s.blocks.iter().position(|x| x.text.starts_with("The road") || x.text.starts_with("Nobody")).unwrap();
    assert_eq!(ragged(text), Some(false));
    // a book whose body says nothing of it: none apart (Thursday's paragraphs)
    let t = book("thursday.epub");
    assert!(chapter(&t, "The Two Poets of Saffron Park").blocks.iter().all(|x| x.set.is_none_or(|s| !s.ragged)));
}

#[test]
fn a_rule_is_drawn_as_the_book_draws_it_and_a_break_with_none_is_the_readers() {
    use typeset_model::Kind;
    // every break's rule in a book: (width, where), none for one it draws no line for
    let rules = |b: &Book| b.sections.iter().flat_map(|s| s.blocks.iter()).filter(|x| x.kind == Kind::Break).map(|x| x.rule.map(|rule| (r(rule.width), rule.align))).collect::<Vec<_>>();
    // a small press's `hr.rule { border-top: 1px solid; width: 30%; margin: 0.8em 0 }`: a
    // third at the start
    assert!(rules(&book("original.epub")).iter().all(|r| *r == Some((0.3, 0))), "{:?}", rules(&book("original.epub")));
    // Gutenberg's `hr { width: 80% }` (the browser's border, centred)
    assert!(rules(&book("thursday.epub")).contains(&Some((0.8, 1))));
    let hr = |css: &str| rules(&typeset_ingest::any(&epub_full("T", "One", "<p>Before.</p><hr/><p>After.</p>", Some(css)), "x.epub").unwrap());
    // Standard Ebooks', as they write it: a quarter, centred
    assert_eq!(hr("hr { border: none; border-top: 1px solid; height: 0; margin-top: 1.5em; margin-right: auto; margin-bottom: 1.5em; margin-left: auto; width: 25%; }"), vec![Some((0.25, 1))]);
    // `border: 0` with nothing else: no line, so the reader's own break
    assert_eq!(hr("hr { border: 0 }"), vec![None]);
}
