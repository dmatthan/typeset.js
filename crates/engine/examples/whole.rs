//! Whole-book layout through the engine: cargo run --release --features parallel --example whole -- book.epub
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let font = |n: &str| std::fs::read(format!("{}/../../assets/fonts/{n}", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut e = typeset_engine::Engine::new();
    e.add_font("Literata", font("Literata.ttf")).unwrap();
    e.add_font("Literata", font("Literata-Italic.ttf")).unwrap();
    e.add_patterns_from(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/hyph")));
    let t = std::time::Instant::now();
    let id = e.import(&std::fs::read(&a[1]).unwrap(), &a[1]).unwrap();
    let t_imp = t.elapsed();
    let p = typeset_engine::Request::plain(19.0, 580.0, 24);
    let t = std::time::Instant::now();
    let one = e.layout(&id, &[3], &p).unwrap();
    let t_one = t.elapsed();
    let t = std::time::Instant::now();
    let all = e.layout(&id, &[], &p).unwrap();
    let t_all = t.elapsed();
    let t = std::time::Instant::now();
    let json = e.book_json(&id).unwrap();
    let t_json = t.elapsed();
    let saved = e.save(&id).unwrap();
    let t = std::time::Instant::now();
    e.restore(&saved).unwrap();
    let t_restore = t.elapsed();
    let t = std::time::Instant::now();
    let f1 = e.find(&id, "dorothea", 5000).unwrap();
    let t_find_cold = t.elapsed();
    let t = std::time::Instant::now();
    let f2 = e.find(&id, "the", 5000).unwrap();
    let f3 = e.find(&id, "said dorothea quickly", 5000).unwrap();
    let t_find_warm = t.elapsed() / 2;
    println!(
        "find: index + first query {t_find_cold:?} ({} hits) | warm query {t_find_warm:?} (\"the\": {}, phrase-less: {} paragraphs)",
        f1[0], f2[0], f3[0]
    );
    println!(
        "import {t_imp:?} | one chapter {t_one:?} ({} B) | rest of book {t_all:?} ({} KB) | json {t_json:?} ({} KB) | model {} KB restore {t_restore:?}",
        one.len(),
        all.len() / 1024,
        json.len() / 1024,
        saved.len() / 1024
    );
}
