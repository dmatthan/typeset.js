//! Paragraphs that are mostly set in a style (italic 1, bold 2, small caps 4), to check
//! what a publisher's styles did:  cargo run -p typeset-ingest --example styled -- file [bit]
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let bit: u8 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let b = typeset_ingest::any(&bytes, &a[1]).unwrap();
    let mut n = 0;
    for blk in b.sections.iter().flat_map(|s| &s.blocks) {
        let st: u32 = blk.runs.iter().filter(|r| r.style & bit != 0).map(|r| r.end - r.start).sum();
        if st as usize * 2 > blk.text.len() && blk.text.len() > 40 {
            n += 1;
            if n <= 8 { println!("{:?} {}", blk.kind, blk.text.chars().take(110).collect::<String>()); }
        }
    }
    println!("{n} paragraphs mostly in style {bit}");
}
