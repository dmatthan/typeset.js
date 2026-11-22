//! What each file comes out as, in numbers, to compare importer versions on many books:
//!     cargo run --release -p typeset-ingest --example census -- file...
//! name, sections, blocks, words, then the characters set italic, bold, small caps.
fn main() {
    for f in std::env::args().skip(1) {
        let bytes = std::fs::read(&f).unwrap();
        let name = std::path::Path::new(&f).file_name().unwrap().to_string_lossy().to_string();
        match typeset_ingest::any(&bytes, &name) {
            Ok(b) => {
                let (mut blocks, mut words, mut it, mut bd, mut sc) = (0, 0, 0, 0, 0);
                for blk in b.sections.iter().flat_map(|s| &s.blocks) {
                    blocks += 1;
                    words += blk.text.split_whitespace().count();
                    for r in &blk.runs {
                        let n = (r.end - r.start) as usize;
                        if r.style & typeset_model::style::ITALIC != 0 { it += n }
                        if r.style & typeset_model::style::BOLD != 0 { bd += n }
                        if r.style & typeset_model::style::SMALLCAPS != 0 { sc += n }
                    }
                }
                println!("{name}\t{}\t{blocks}\t{words}\t{it}\t{bd}\t{sc}", b.sections.len());
            }
            Err(e) => println!("{name}\terror: {e}"),
        }
    }
}
