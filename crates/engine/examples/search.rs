//! Library search on corpus books, timed: cargo run --release -p typeset-engine --example search -- "query" a.epub b.epub …
use std::time::Instant;
use typeset_engine::search::{fts_rows, in_book};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let query = &a[1];
    for path in &a[2..] {
        let book = typeset_ingest::any(&std::fs::read(path).unwrap(), path).unwrap();
        let saved = book.save().unwrap();
        let t = Instant::now();
        let back = typeset_engine::Book::restore(&saved).unwrap();
        let restore = t.elapsed();
        let t = Instant::now();
        let rows = fts_rows(&back).count();
        let fold = t.elapsed();
        let t = Instant::now();
        let hits = in_book(&back, None, query, 3);
        let scan = t.elapsed();
        println!("{}: {} KB saved, restore {restore:.1?}, fold {rows} paragraphs {fold:.1?}, whole-book search {scan:.1?}: {}", back.meta.title, saved.len() / 1024, hits.map(|h| format!("{} found, e.g. …{}[{}]{}", h.total, h.hits[0].before, h.hits[0].matched, h.hits[0].after)).unwrap_or("none".into()));
    }
}
