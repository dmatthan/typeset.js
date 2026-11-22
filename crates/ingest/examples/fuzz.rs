//! Feeds the importers damaged copies of real files (cut short, bytes changed, runs of bytes
//! dropped or overwritten) and reports every panic: a bad file must give an error, never a crash.
//!
//!     cargo run -p typeset-ingest --example fuzz -- [rounds] file...
//!
//! (Not with --release: the release profile aborts on a panic, so none could be counted.)
use std::panic;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let rounds: usize = args.first().and_then(|a| a.parse().ok()).inspect(|_| { args.remove(0); }).unwrap_or(200);
    panic::set_hook(Box::new(|_| {}));
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut rnd = move || { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; seed };
    let mut found = std::collections::BTreeMap::<String, (usize, String)>::new();
    for f in &args {
        let src = std::fs::read(f).unwrap();
        let name = std::path::Path::new(f).file_name().unwrap().to_string_lossy().to_string();
        let mut tries: Vec<(String, Vec<u8>)> = vec![("whole".into(), src.clone())];
        for i in 0..rounds {
            let mut b = src.clone();
            let how = match i % 4 {
                0 => { let n = (rnd() as usize) % b.len().max(1); b.truncate(n); format!("cut {n}") }
                1 => { for _ in 0..1 + rnd() % 8 { let at = (rnd() as usize) % b.len(); b[at] = rnd() as u8; } "flip".into() }
                2 => { let at = (rnd() as usize) % b.len(); let n = 1 + (rnd() as usize) % 64; b.drain(at..(at + n).min(b.len())); format!("drop {at}") }
                _ => { let at = (rnd() as usize) % b.len(); for k in at..(at + 16).min(b.len()) { b[k] = 0xff; } format!("ff {at}") }
            };
            tries.push((how, b));
        }
        for (how, b) in tries {
            for n in [name.clone(), name.replace('.', "_") + ".txt"] {
                let r = panic::catch_unwind(|| typeset_ingest::any(&b, &n).map(|bk| bk.sections.len()));
                if let Err(e) = r {
                    let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                    let ent = found.entry(msg).or_insert((0, format!("{name} as {n}: {how}")));
                    ent.0 += 1;
                }
            }
        }
    }
    for (msg, (n, first)) in &found {
        println!("{n:5}× {msg}\n       first: {first}");
    }
    if found.is_empty() { println!("no panics"); }
}
