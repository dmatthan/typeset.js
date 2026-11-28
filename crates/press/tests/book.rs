//! A book's own structure, set on the press's rows. A chapter's head takes the rows it
//! needs, and the text begins on the row after it: its lines broken at their own sizes as
//! the text is (first fit over the measure, a '\n' a break), the space above and below in
//! the text's em, rounded up to whole rows. A paragraph takes its book's indent, and its
//! space above in whole rows. A book that says neither (Word, Markdown) keeps the house's.
//! A break the book draws as a rule is that rule, between its two rows; one it draws as
//! nothing is the reader's ⁂.
use typeset_model::{Block, Book, Head, HeadLine, Kind, Section, SectionKind};
use typeset_press::fill::{Params, SectionLayout};
use typeset_press::shape::{Typeface, Typo};
use typeset_press::{HEAD_LEADING, Press};

fn press() -> Press {
    let d = concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/fonts/");
    Press::new(Typeface::single(vec![std::fs::read(format!("{d}Literata.ttf")).unwrap()]).unwrap())
}

fn block(key: u64, kind: Kind, text: &str) -> Block {
    Block::new(key, kind, text.into(), vec![])
}

/// A book of one section.
fn book_of(sec: Section) -> Book {
    Book {
        id: "b".into(),
        meta: Default::default(),
        sections: vec![sec],
        notes: vec![],
        images: vec![],
        leading: None,
        cover: None,
    }
}

/// A section with no chapter head (front matter) of `blocks`.
fn front(blocks: Vec<Block>) -> Section {
    Section {
        kind: SectionKind::Front,
        part: String::new(),
        label: String::new(),
        num: String::new(),
        title: String::new(),
        blocks,
        head: None,
    }
}

/// The press as these tests set text: 16 px on 30 rows of 21, `measure` wide, `head_rows`
/// kept for the reader's own head.
fn params(measure: f32, head_rows: u32) -> Params {
    Params {
        typo: Typo::plain(16.0, false),
        measure,
        rows: 30,
        head_rows,
        lh: 21.0,
        link_runs: false,
        justify: true,
        hyphenate: false,
    }
}

fn lay(head: Option<Head>, measure: f32) -> (SectionLayout, Params) {
    let text = (0..40)
        .map(|i| {
            block(
                i + 10,
                Kind::P,
                "The suburb of Saffron Park lay on the sunset side of London, as red and ragged as a cloud of sunset.",
            )
        })
        .collect();
    let sec = Section {
        kind: SectionKind::Chapter,
        part: String::new(),
        label: "Chapter I".into(),
        num: "I".into(),
        title: "The Two Poets".into(),
        blocks: text,
        head,
    };
    let p = params(measure, 7);
    (press().section(&book_of(sec), 0, &p, None), p)
}

fn thursday() -> Head {
    Head {
        lines: vec![HeadLine {
            block: block(1, Kind::H, "CHAPTER I.\nTHE TWO POETS OF SAFFRON PARK"),
            size: 1.5,
            align: 1,
        }],
        above: 1.5,
        below: 1.5,
    }
}

/// The row of the text's first line.
fn first_row(l: &SectionLayout) -> u32 {
    l.lines.iter().filter(|x| x.col == 0).map(|x| x.row).min().unwrap()
}

#[test]
fn the_text_begins_on_the_row_after_the_head() {
    // a measure wide enough for each of the head's two lines whole: 1.5 em above and below,
    // two lines at 1.5 em set at the head's leading
    let (l, p) = lay(Some(thursday()), 2000.0);
    let px = 3.0 * 16.0 + 2.0 * 1.5 * 16.0 * HEAD_LEADING;
    assert_eq!(l.head_rows, (px / p.lh).ceil() as u32);
    assert_eq!(first_row(&l), l.head_rows);
}

#[test]
fn a_head_that_wraps_takes_more_rows() {
    let (wide, _) = lay(Some(thursday()), 2000.0);
    let (narrow, _) = lay(Some(thursday()), 180.0);
    assert!(narrow.head_rows > wide.head_rows, "{} {}", narrow.head_rows, wide.head_rows);
    assert_eq!(first_row(&narrow), narrow.head_rows);
}

#[test]
fn a_book_without_heads_keeps_the_house_rows_and_a_head_leaves_room_for_text() {
    let (l, p) = lay(None, 400.0);
    assert_eq!((l.head_rows, first_row(&l)), (p.head_rows, p.head_rows));
    // a head taller than the page: two rows of text kept under it
    let tall = Head {
        lines: vec![HeadLine { block: block(1, Kind::H, "A HEAD"), size: 1.5, align: 1 }],
        above: 60.0,
        below: 0.0,
    };
    let (l, p) = lay(Some(tall), 400.0);
    assert_eq!(l.head_rows, p.rows - 2);
}

/// A chapter of paragraphs, each set as given (none: the house's), under no head.
fn paras(sets: &[Option<typeset_model::Setting>]) -> (SectionLayout, Params) {
    let text = sets
        .iter()
        .enumerate()
        .map(|(i, s)| Block {
            set: *s,
            ..block(
                i as u64 + 10,
                Kind::P,
                "The suburb of Saffron Park lay on the sunset side of London, as red and ragged as a cloud of sunset.",
            )
        })
        .collect();
    let p = params(400.0, 0);
    (press().section(&book_of(front(text)), 0, &p, None), p)
}

/// Each paragraph's first line: its row and its indent.
fn firsts(l: &SectionLayout) -> Vec<(u32, f32)> {
    let mut seen = std::collections::BTreeMap::new();
    for x in &l.lines {
        seen.entry(x.block).or_insert((x.row, x.x));
    }
    seen.into_values().collect()
}

#[test]
fn a_paragraph_the_book_sets_takes_its_indent_and_its_space_in_whole_rows() {
    let set = |indent: f32, above: f32| Some(typeset_model::Setting { indent, above, ragged: false });
    // a quarter em above is less than half a row: none; a whole em (16 of 21 px) a row
    let (l, _) = paras(&[set(1.0, 0.25), set(1.0, 0.25), set(0.0, 1.0)]);
    let f = firsts(&l);
    assert_eq!(f.iter().map(|x| x.1).collect::<Vec<_>>(), [16.0, 16.0, 0.0]);
    let rows: Vec<u32> = f.iter().map(|x| x.0).collect();
    // the second follows the first's last line directly; the third a row further on
    let last = |b: u32| l.lines.iter().filter(|x| x.block == b).map(|x| x.row).max().unwrap();
    assert_eq!(rows[1], last(0) + 1);
    assert_eq!(rows[2], last(1) + 2);
}

#[test]
fn paragraphs_no_book_sets_keep_the_house_rule() {
    // the first flush, the rest 1.3 em in, none apart
    let (l, _) = paras(&[None, None]);
    let f = firsts(&l);
    assert_eq!(f.iter().map(|x| x.1).collect::<Vec<_>>(), [0.0, 16.0 * 1.3]);
}

#[test]
fn a_rule_the_book_draws_is_drawn_between_the_rows_of_its_break_at_its_width_and_place() {
    use typeset_model::Rule;
    use typeset_press::fill::flag;
    let p_ = |k: u64| block(k, Kind::P, "The suburb of Saffron Park lay on the sunset side of London.");
    let brk = |k: u64, rule: Option<Rule>| Block { rule, ..block(k, Kind::Break, "") };
    let blocks = vec![
        p_(1),
        brk(2, Some(Rule { width: 0.3, align: 0 })),
        p_(3),
        brk(4, Some(Rule { width: 0.5, align: 1 })),
        p_(5),
        brk(6, None),
        p_(7),
    ];
    let p = params(400.0, 0);
    let l = press().section(&book_of(front(blocks)), 0, &p, None);
    // the rules: (block, x, width), the row each is drawn at the second of its break's
    let rules: Vec<(u32, f32, f32)> =
        l.lines.iter().filter(|x| x.flags & flag::RULE != 0).map(|x| (x.block, x.x, x.avail)).collect();
    assert_eq!(rules, vec![(1, 0.0, 120.0), (3, 100.0, 200.0)]);
    for b in [1, 3] {
        let rows: Vec<u32> = l.lines.iter().filter(|x| x.block == b).map(|x| x.row).collect();
        assert_eq!(rows.len(), 2, "{b}: {rows:?}");
        assert_eq!(l.lines.iter().find(|x| x.block == b && x.flags & flag::RULE != 0).unwrap().row, rows[0] + 1);
    }
    // a break with no rule: the reader's mark, as ever
    assert!(l.lines.iter().any(|x| x.block == 5 && x.flags & flag::BREAK != 0 && x.flags & flag::FIRST != 0));
    assert!(!l.lines.iter().any(|x| x.block == 5 && x.flags & flag::RULE != 0));
}
