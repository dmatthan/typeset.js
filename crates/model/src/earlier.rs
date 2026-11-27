//! Earlier saved forms, read into this one: before the book's own leading (v4), before
//! chapter heads (v3), before tables (v2), and before notes, links and images (v1). What they lack comes with the next import of
//! the book's file.
use serde::Deserialize;

// (written only by the test below, which checks they are still read)
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct Section<B> {
    kind: super::SectionKind,
    part: String,
    label: String,
    num: String,
    title: String,
    blocks: Vec<B>,
}
impl<B: Into<super::Block>> From<Section<B>> for super::Section {
    fn from(s: Section<B>) -> Self {
        super::Section { kind: s.kind, part: s.part, label: s.label, num: s.num, title: s.title, blocks: s.blocks.into_iter().map(Into::into).collect(), head: None }
    }
}

// Form 4, as it was written: its own shapes, frozen (a head's lines without where they are
// set, a paragraph's setting without its raggedness, a break without its rule).
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub struct V4 {
    id: String,
    meta: super::Meta,
    sections: Vec<V4Section>,
    notes: Vec<super::Note>,
    images: Vec<super::Image>,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V4Section {
    kind: super::SectionKind,
    part: String,
    label: String,
    num: String,
    title: String,
    blocks: Vec<V4Block>,
    head: Option<V4Head>,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V4Head {
    lines: Vec<(V4Block, f32)>,
    above: f32,
    below: f32,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V4Block {
    key: u64,
    kind: super::Kind,
    text: String,
    runs: Vec<super::Run>,
    links: Vec<super::Link>,
    image: Option<u32>,
    table: Option<super::TableShape>,
    set: Option<(f32, f32)>,
}
impl From<V4Block> for super::Block {
    fn from(b: V4Block) -> Self {
        let set = b.set.map(|(indent, above)| super::Setting { indent, above, ragged: false });
        super::Block { links: b.links, image: b.image, table: b.table, set, ..super::Block::new(b.key, b.kind, b.text, b.runs) }
    }
}
impl From<V4> for super::Book {
    fn from(b: V4) -> Self {
        let sections = b
            .sections
            .into_iter()
            .map(|s| super::Section {
                kind: s.kind,
                part: s.part,
                label: s.label,
                num: s.num,
                title: s.title,
                blocks: s.blocks.into_iter().map(Into::into).collect(),
                // (centred, as the reader set every head then)
                head: s.head.map(|h| super::Head { lines: h.lines.into_iter().map(|(b, size)| super::HeadLine { block: b.into(), size, align: 1 }).collect(), above: h.above, below: h.below }),
            })
            .collect();
        super::Book { id: b.id, meta: b.meta, sections, notes: b.notes, images: b.images, leading: None, cover: None }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub struct V3 {
    id: String,
    meta: super::Meta,
    sections: Vec<Section<V3Block>>,
    notes: Vec<super::Note>,
    images: Vec<super::Image>,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V3Block {
    key: u64,
    kind: super::Kind,
    text: String,
    runs: Vec<super::Run>,
    links: Vec<super::Link>,
    image: Option<u32>,
    table: Option<super::TableShape>,
}
impl From<V3Block> for super::Block {
    fn from(b: V3Block) -> Self {
        super::Block { links: b.links, image: b.image, table: b.table, ..super::Block::new(b.key, b.kind, b.text, b.runs) }
    }
}
impl From<V3> for super::Book {
    fn from(b: V3) -> Self {
        super::Book { id: b.id, meta: b.meta, sections: b.sections.into_iter().map(Into::into).collect(), notes: b.notes, images: b.images, leading: None, cover: None }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub struct V2 {
    id: String,
    meta: super::Meta,
    sections: Vec<Section<V2Block>>,
    notes: Vec<super::Note>,
    images: Vec<super::Image>,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V2Block {
    key: u64,
    kind: super::Kind,
    text: String,
    runs: Vec<super::Run>,
    links: Vec<super::Link>,
    image: Option<u32>,
}
impl From<V2Block> for super::Block {
    fn from(b: V2Block) -> Self {
        super::Block { links: b.links, image: b.image, ..super::Block::new(b.key, b.kind, b.text, b.runs) }
    }
}
impl From<V2> for super::Book {
    fn from(b: V2) -> Self {
        super::Book { id: b.id, meta: b.meta, sections: b.sections.into_iter().map(Into::into).collect(), notes: b.notes, images: b.images, leading: None, cover: None }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub struct V1 {
    id: String,
    meta: super::Meta,
    sections: Vec<Section<V1Block>>,
}
#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
struct V1Block {
    key: u64,
    kind: super::Kind,
    text: String,
    runs: Vec<super::Run>,
}
impl From<V1Block> for super::Block {
    fn from(b: V1Block) -> Self {
        super::Block::new(b.key, b.kind, b.text, b.runs)
    }
}
impl From<V1> for super::Book {
    fn from(b: V1) -> Self {
        super::Book { id: b.id, meta: b.meta, sections: b.sections.into_iter().map(Into::into).collect(), notes: vec![], images: vec![], leading: None, cover: None }
    }
}

#[test]
fn books_saved_in_earlier_forms_are_read() {
    fn section<B>(blocks: Vec<B>) -> Section<B> {
        Section { kind: super::SectionKind::Chapter, part: String::new(), label: "I".into(), num: "1".into(), title: "One".into(), blocks }
    }
    let meta = super::Meta { title: "Old".into(), ..Default::default() };
    let v1 = V1 { id: "a".into(), meta: meta.clone(), sections: vec![section(vec![V1Block { key: 7, kind: super::Kind::P, text: "First.".into(), runs: vec![] }])] };
    let b = super::Book::restore(&postcard::to_allocvec(&v1).unwrap()).unwrap();
    assert_eq!((b.sections[0].title.as_str(), b.sections[0].blocks[0].text.as_str(), b.sections[0].blocks[0].key), ("One", "First.", 7));
    let v2 = V2 { id: "b".into(), meta, sections: vec![section(vec![V2Block { key: 9, kind: super::Kind::P, text: "Second.".into(), runs: vec![], links: vec![], image: Some(0) }])], notes: vec![], images: vec![] };
    let mut bytes = super::SAVE_MAGIC_V2.to_vec();
    bytes.extend(postcard::to_allocvec(&v2).unwrap());
    let b = super::Book::restore(&bytes).unwrap();
    assert_eq!((b.id.as_str(), b.sections[0].blocks[0].text.as_str(), b.sections[0].blocks[0].image), ("b", "Second.", Some(0)));
    let v3 = V3 { id: "c".into(), meta: super::Meta::default(), sections: vec![section(vec![V3Block { key: 3, kind: super::Kind::P, text: "Third.".into(), runs: vec![], links: vec![], image: None, table: None }])], notes: vec![], images: vec![] };
    let mut bytes = super::SAVE_MAGIC_V3.to_vec();
    bytes.extend(postcard::to_allocvec(&v3).unwrap());
    let b = super::Book::restore(&bytes).unwrap();
    assert_eq!((b.id.as_str(), b.sections[0].blocks[0].text.as_str(), b.sections[0].head.is_none()), ("c", "Third.", true));
    // (form 4 as written: a head, a paragraph's setting)
    let v4block = |key, kind, text: &str, set| V4Block { key, kind, text: text.into(), runs: vec![], links: vec![], image: None, table: None, set };
    let v4 = V4 {
        id: "d".into(),
        meta: super::Meta::default(),
        sections: vec![V4Section { kind: super::SectionKind::Chapter, part: String::new(), label: "I".into(), num: "1".into(), title: "One".into(), blocks: vec![v4block(4, super::Kind::P, "Fourth.", Some((1.0, 0.25)))], head: Some(V4Head { lines: vec![(v4block(5, super::Kind::H, "ONE", None), 1.5)], above: 1.5, below: 1.0 }) }],
        notes: vec![],
        images: vec![],
    };
    let mut bytes = super::SAVE_MAGIC_V4.to_vec();
    bytes.extend(postcard::to_allocvec(&v4).unwrap());
    let b = super::Book::restore(&bytes).unwrap();
    let (s, h) = (&b.sections[0], b.sections[0].head.as_ref().unwrap());
    assert_eq!((b.id.as_str(), s.blocks[0].text.as_str(), s.blocks[0].set.map(|x| (x.indent, x.above, x.ragged)), b.leading), ("d", "Fourth.", Some((1.0, 0.25, false)), None));
    assert_eq!((h.lines[0].block.text.as_str(), h.lines[0].size, h.lines[0].align, h.below), ("ONE", 1.5, 1, 1.0));
    // and this form keeps the book's leading
    let b = super::Book { leading: Some(1.5), ..b };
    assert_eq!(super::Book::restore(&b.save().unwrap()).unwrap().leading, Some(1.5));
}
