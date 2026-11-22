//! What a book's notes, links and images came out as:
//!   cargo run -p typeset-ingest --example content -- book.epub [notes to show]
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let t = std::time::Instant::now();
    let book = typeset_ingest::any(&bytes, &a[1]).unwrap();
    let show: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(3);
    let mut n_links = [0usize; 3];
    for s in &book.sections {
        for b in &s.blocks {
            for l in &b.links {
                n_links[match l.to { typeset_model::Target::Note(_) => 0, typeset_model::Target::Block(_) => 1, typeset_model::Target::Url(_) => 2 }] += 1;
            }
        }
    }
    let imgs = book.sections.iter().flat_map(|s| &s.blocks).filter(|b| b.image.is_some()).count();
    println!("{} | {:?} | {} sections | notes {} | note refs {}, cross-refs {}, web links {} | images {} ({} blocks)", book.meta.title, t.elapsed(), book.sections.len(), book.notes.len(), n_links[0], n_links[1], n_links[2], book.images.len(), imgs);
    for n in book.notes.iter().take(show) {
        let t: String = n.text.chars().take(160).collect();
        println!("  note [{}] at={} : {}", n.label, n.at.is_some(), t.replace('\n', " ⏎ "));
    }
    // a reference in context
    'outer: for s in &book.sections {
        for b in &s.blocks {
            if let Some(l) = b.links.iter().find(|l| matches!(l.to, typeset_model::Target::Note(_))) {
                let a = b.text[..l.start as usize].char_indices().rev().nth(50).map(|x| x.0).unwrap_or(0);
                println!("  ref in text: …{}[{}]…", &b.text[a..l.start as usize], &b.text[l.start as usize..l.end as usize]);
                break 'outer;
            }
        }
    }
    for i in book.images.iter().take(3) {
        println!("  image {}×{} {} {} KB: {}", i.w, i.h, i.mime, i.bytes.len() / 1024, i.alt.chars().take(60).collect::<String>());
    }
}
