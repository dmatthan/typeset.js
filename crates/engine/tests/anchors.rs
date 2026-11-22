//! Notes carried to a revised draft. A corpus book is revised by rule — paragraphs added,
//! deleted, moved, reworded — with block keys assigned as the importer assigns them (by
//! place, so everything after an edit gets a new key), and notes made on the first draft
//! are placed on the second. The revision knows where each note belongs; a note put on
//! the wrong words is the failure that matters.
use typeset_engine::anchor::{pos_of, Anchor, Anchorer, How};
use typeset_model::Book;

fn book(name: &str) -> Option<Book> {
    let p = format!("{}/../../corpus/{name}", env!("CARGO_MANIFEST_DIR"));
    let bytes = std::fs::read(&p).ok()?;
    Some(typeset_ingest::any(&bytes, &p).unwrap())
}

/// Keys by place, as the importer gives them: a section's file and the block's ordinal.
fn rekey(b: &mut Book) {
    for (si, sec) in b.sections.iter_mut().enumerate() {
        let file = typeset_model::fnv64(format!("chapter{si}.xhtml").as_bytes());
        for (o, blk) in sec.blocks.iter_mut().enumerate() {
            blk.key = file ^ ((o as u64 + 1).wrapping_mul(0x9e3779b97f4a7c15));
        }
    }
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) as u32
    }
    fn chance(&mut self, p: f32) -> bool {
        (self.next() % 10000) as f32 / 10000.0 < p
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Fate {
    Kept,
    Reworded,
    Deleted,
}

/// The second draft, and for each block of the first (by section and index) its fate
/// and new key.
fn revise(v1: &Book, seed: u64) -> (Book, Vec<Vec<(Fate, u64)>>, Vec<Vec<std::collections::HashSet<usize>>>) {
    let mut r = Lcg(seed);
    let mut v2 = v1.clone();
    // track blocks through the edits by an id of their own
    let mut ids: Vec<Vec<Option<(usize, usize)>>> = Vec::new();
    let mut fate: Vec<Vec<Fate>> = v1.sections.iter().map(|s| vec![Fate::Kept; s.blocks.len()]).collect();
    let mut touched: Vec<Vec<std::collections::HashSet<usize>>> = v1.sections.iter().map(|s| vec![Default::default(); s.blocks.len()]).collect();
    let filler = ["The rain came down over the town and nobody spoke of it again.", "He waited by the window for a long time, saying nothing at all.", "Later, much later, she would remember the smell of the river."];
    for (si, sec) in v2.sections.iter_mut().enumerate() {
        let mut out: Vec<(Option<(usize, usize)>, typeset_model::Block)> = Vec::new();
        let mut moved: Vec<(usize, (Option<(usize, usize)>, typeset_model::Block))> = Vec::new();
        for (bi, blk) in sec.blocks.iter().enumerate() {
            if r.chance(0.08) {
                let mut nb = blk.clone();
                nb.text = filler[r.next() as usize % filler.len()].to_string();
                nb.runs.clear();
                nb.links.clear();
                out.push((None, nb));
            }
            if r.chance(0.06) && !blk.text.is_empty() {
                fate[si][bi] = Fate::Deleted;
                continue;
            }
            let mut b = blk.clone();
            if r.chance(0.18) && !b.text.is_empty() {
                // reword: drop, replace or swap a word here and there
                // (each word with its index in the first draft, to know which were touched)
                let mut ws: Vec<(usize, String)> = b.text.split(' ').map(str::to_string).enumerate().collect();
                let mut i = 0;
                while i < ws.len() {
                    if r.chance(0.12) {
                        match r.next() % 3 {
                            0 if ws.len() > 4 => {
                                touched[si][bi].insert(ws[i].0);
                                ws.remove(i);
                            }
                            1 => {
                                touched[si][bi].insert(ws[i].0);
                                ws[i].1 = "very".into();
                            }
                            _ if i + 1 < ws.len() => {
                                touched[si][bi].insert(ws[i].0);
                                touched[si][bi].insert(ws[i + 1].0);
                                ws.swap(i, i + 1);
                            }
                            _ => {}
                        }
                    }
                    i += 1;
                }
                let t = ws.iter().map(|w| w.1.as_str()).collect::<Vec<_>>().join(" ");
                if t != b.text {
                    b.text = t;
                    b.runs.clear();
                    b.links.clear();
                    fate[si][bi] = Fate::Reworded;
                }
            }
            if r.chance(0.04) {
                moved.push((out.len() + 3 + (r.next() as usize % 8), (Some((si, bi)), b)));
                continue;
            }
            out.push((Some((si, bi)), b));
        }
        for (at, item) in moved.into_iter().rev() {
            let at = at.min(out.len());
            out.insert(at, item);
        }
        ids.push(out.iter().map(|(id, _)| *id).collect());
        sec.blocks = out.into_iter().map(|(_, b)| b).collect();
    }
    rekey(&mut v2);
    let mut keys: Vec<Vec<(Fate, u64)>> = fate.iter().map(|f| f.iter().map(|&x| (x, 0)).collect()).collect();
    for (si, sec) in v2.sections.iter().enumerate() {
        for (bi, blk) in sec.blocks.iter().enumerate() {
            if let Some((a, b)) = ids[si][bi] {
                keys[a][b].1 = blk.key;
            }
        }
    }
    (v2, keys, touched)
}

/// Notes on the first draft: in every fifth paragraph of ten words or more, a run of 1,
/// 3, 6 or 12 words.
fn notes(v1: &Book) -> Vec<(usize, usize, Anchor, std::ops::Range<usize>)> {
    let mut out = Vec::new();
    let mut n = 0;
    for (si, sec) in v1.sections.iter().enumerate() {
        for (bi, blk) in sec.blocks.iter().enumerate() {
            // (byte range, index among the text split at spaces)
            let words: Vec<(usize, usize, usize)> = {
                let t = &blk.text;
                let mut v = Vec::new();
                let mut at = 0;
                for (k, w) in t.split(' ').enumerate() {
                    if !w.is_empty() {
                        v.push((at, at + w.len(), k));
                    }
                    at += w.len() + 1;
                }
                v
            };
            if words.len() < 10 {
                continue;
            }
            n += 1;
            if n % 5 != 0 {
                continue;
            }
            let k = [1, 3, 6, 12][(n / 5) % 4].min(words.len() - 2);
            let w0 = (n * 7) % (words.len() - k);
            let (bs, be) = (words[w0].0, words[w0 + k - 1].1);
            let t = &blk.text;
            let u16 = |b: usize| t[..b].encode_utf16().count() as u32;
            let ps = t[..bs].char_indices().rev().nth(31).map(|(i, _)| i).unwrap_or(0);
            let pe = t[be..].char_indices().nth(32).map(|(i, _)| be + i).unwrap_or(t.len());
            let span = words[w0].2..words[w0 + k - 1].2 + 1;
            out.push((si, bi, Anchor { key: format!("{:016x}", blk.key), s: u16(bs), e: u16(be), quote: t[bs..be].to_string(), prefix: t[ps..bs].to_string(), suffix: t[be..pe].to_string(), pos: pos_of(v1, blk.key) }, span));
        }
    }
    out
}

fn run(name: &str, seed: u64) -> Option<[usize; 10]> {
    let mut v1 = book(name)?;
    rekey(&mut v1);
    let (v2, truth, touched) = revise(&v1, seed);
    let anchors = notes(&v1);
    let t = std::time::Instant::now();
    let a = Anchorer::new(&v2);
    // [kept: right, other; reworded: carried, lost, misplaced; deleted: lost, placed; total ms*, count]
    let mut c = [0usize; 10];
    for (si, bi, an, span) in &anchors {
        let p = a.place(an);
        let (fate, key) = truth[*si][*bi];
        let at = format!("{key:016x}");
        match fate {
            Fate::Kept => {
                if p.key == at && p.s == an.s && p.e == an.e { c[0] += 1 } else {
                    c[1] += 1;
                    eprintln!("kept but placed {:?} at {} {}..{} (want {at} {}..{}): {:?}", p.how, p.key, p.s, p.e, an.s, an.e, an.quote);
                }
            }
            Fate::Reworded => {
                let hit = span.clone().filter(|w| touched[*si][*bi].contains(w)).count();
                let n = span.len();
                // its words untouched (only around it), or most of three or more left
                let should = hit == 0 || (n >= 3 && (n - hit) * 10 >= n * 6);
                if !should {
                    if p.how == How::Lost || p.key == at { c[9] += 1 } else { c[4] += 1; eprintln!("destroyed, misplaced {:?}: {:?}", p.how, an.quote); }
                } else if p.how == How::Lost {
                    c[3] += 1;
                    if std::env::var("SHOW_LOST").is_ok() {
                        let now = v2.sections.iter().flat_map(|s| &s.blocks).find(|b| b.key == key).map(|b| b.text.clone()).unwrap_or_default();
                        eprintln!("LOST {:?} ({hit} of {n} touched) pre {:?} suf {:?} | now: {:?}", an.quote, an.prefix, an.suffix, now);
                    }
                } else if p.key == at { c[2] += 1 } else {
                    c[4] += 1;
                    eprintln!("reworded, misplaced {:?}: {:?}", p.how, an.quote);
                }
            }
            Fate::Deleted => {
                if p.how == How::Lost { c[5] += 1 } else {
                    c[6] += 1;
                    let now = v2.sections.iter().flat_map(|s| &s.blocks).find(|b| format!("{:016x}", b.key) == p.key).map(|b| b.text.clone()).unwrap_or_default();
                    let u: Vec<u16> = now.encode_utf16().collect();
                    eprintln!("deleted, placed {:?}: {:?} pre {:?} suf {:?} -> {:?}", p.how, an.quote, an.prefix, an.suffix, String::from_utf16_lossy(&u[(p.s as usize).saturating_sub(30)..(p.e as usize + 30).min(u.len())]));
                }
            }
        }
    }
    c[7] = t.elapsed().as_millis() as usize;
    c[8] = anchors.len();
    println!("{name}: {} notes; kept {} right, {} wrong; reworded {} carried, {} lost, {} misplaced, {} with their words gone; deleted {} lost, {} placed; {} ms", c[8], c[0], c[1], c[2], c[3], c[4], c[9], c[5], c[6], c[7]);
    Some(c)
}

#[test]
fn notes_carry_to_a_revised_draft() {
    for (name, seed) in [("thursday.epub", 1), ("thursday.epub", 2), ("beagle.epub", 3), ("middlemarch.epub", 4)] {
        let Some(c) = run(name, seed) else { continue };
        // every note whose words survived lands on them
        assert_eq!(c[1], 0, "{name}: kept text misplaced");
        // nothing is put on the wrong words
        let wrong = c[4] + c[6];
        assert!(wrong * 100 <= c[8], "{name}: {wrong} misplaced of {}", c[8]);
        // reworded passages whose words mostly survive are followed
        assert!(c[2] * 100 >= (c[2] + c[3]) * 90, "{name}: reworded carried {} lost {}", c[2], c[3]);
    }
}

/// The second draft rebuilt rather than reworded: paragraphs split at a sentence, pairs of
/// paragraphs joined into one, two chapters swapped. No note's words change: every note
/// lands on its own words wherever they now are (one cut across a split, on the larger
/// part of them), or, rarely, is not placed; never on others.
#[test]
fn notes_follow_paragraphs_split_joined_and_chapters_reordered() {
    for name in ["thursday.epub", "middlemarch.epub"] {
        let Some(mut v1) = book(name) else { continue };
        rekey(&mut v1);
        let anchors = notes(&v1);
        let mut v2 = v1.clone();
        for (si, sec) in v2.sections.iter_mut().enumerate() {
            let mut out: Vec<typeset_model::Block> = Vec::new();
            let mut join_next = false;
            for (bi, blk) in sec.blocks.iter().enumerate() {
                if join_next
                    && let Some(last) = out.last_mut() {
                        last.text = format!("{} {}", last.text, blk.text);
                        last.runs.clear();
                        last.links.clear();
                        join_next = false;
                        continue;
                    }
                // every seventh paragraph split after its first full stop
                let cut = blk.text.find(". ").filter(|_| (bi + si) % 7 == 3);
                if let Some(c) = cut {
                    let (a, b) = blk.text.split_at(c + 1);
                    let mut x = blk.clone();
                    x.text = a.to_string();
                    x.runs.clear();
                    x.links.clear();
                    let mut y = x.clone();
                    y.text = b.trim_start().to_string();
                    out.push(x);
                    out.push(y);
                    continue;
                }
                out.push(blk.clone());
                // every eleventh joined with the next
                join_next = (bi + si) % 11 == 5;
            }
            sec.blocks = out;
        }
        if v2.sections.len() > 6 {
            v2.sections.swap(4, 5);
        }
        rekey(&mut v2);
        let a = Anchorer::new(&v2);
        let (mut right, mut wrong, mut lost) = (0, 0, 0);
        for (_, _, an, _) in &anchors {
            let p = a.place(an);
            if p.how == How::Lost {
                lost += 1;
                eprintln!("{name}: lost {:?}", an.quote);
                continue;
            }
            let blk = v2.sections.iter().flat_map(|s| &s.blocks).find(|b| format!("{:016x}", b.key) == p.key).unwrap();
            let u: Vec<u16> = blk.text.encode_utf16().collect();
            // (a note across a split lands on the larger part of its words, give or take a
            // word beside them: still its own; wrong is mostly other words)
            let got = String::from_utf16_lossy(&u[p.s as usize..p.e as usize]);
            let gw: Vec<&str> = got.split_whitespace().collect();
            let own = gw.iter().filter(|w| an.quote.split_whitespace().any(|q| q == **w)).count();
            if got == an.quote || (gw.len() >= 3 && own * 10 >= gw.len() * 6) { right += 1 } else {
                wrong += 1;
                eprintln!("{name}: {:?} placed on {:?}", an.quote, String::from_utf16_lossy(&u[p.s as usize..p.e as usize]));
            }
        }
        println!("{name}: {} notes; {right} on their words, {wrong} on others, {lost} lost", anchors.len());
        assert_eq!(wrong, 0, "{name}: notes put on other words");
        // (lost: notes cut across a split or a join, or too short to know once their
        // paragraph is joined to another)
        assert!(lost * 50 <= anchors.len(), "{name}: {lost} of {} lost", anchors.len());
    }
}

/// A short note on words that recur ("he said") lands on its own occurrence: its context
/// and its place in the book choose among them.
#[test]
fn a_short_note_on_common_words_finds_its_own_occurrence() {
    let Some(mut v1) = book("thursday.epub") else { return };
    rekey(&mut v1);
    let phrase = "said Syme";
    // every occurrence, and a note on each
    let mut found = Vec::new();
    for sec in &v1.sections {
        for blk in &sec.blocks {
            let t = &blk.text;
            let mut from = 0;
            while let Some(i) = t[from..].find(phrase) {
                let bs = from + i;
                let be = bs + phrase.len();
                let u16 = |b: usize| t[..b].encode_utf16().count() as u32;
                let ps = t[..bs].char_indices().rev().nth(31).map(|(i, _)| i).unwrap_or(0);
                let pe = t[be..].char_indices().nth(32).map(|(i, _)| be + i).unwrap_or(t.len());
                found.push((blk.key, Anchor { key: format!("{:016x}", blk.key), s: u16(bs), e: u16(be), quote: phrase.into(), prefix: t[ps..bs].into(), suffix: t[be..pe].into(), pos: pos_of(&v1, blk.key) }));
                from = be;
            }
        }
    }
    assert!(found.len() > 10, "{} occurrences", found.len());
    // the next draft: a paragraph added at the start of every chapter, so every key moves
    let mut v2 = v1.clone();
    for sec in &mut v2.sections {
        let mut b = sec.blocks[0].clone();
        b.text = "A new paragraph, added at the start of the chapter, moves everything on.".into();
        b.runs.clear();
        b.links.clear();
        sec.blocks.insert(0, b);
    }
    rekey(&mut v2);
    let a = Anchorer::new(&v2);
    let mut wrong = 0;
    for (old, an) in &found {
        let p = a.place(an);
        // the same paragraph, now one later in its chapter
        let (si, bi) = v1.sections.iter().enumerate().find_map(|(si, s)| s.blocks.iter().position(|b| b.key == *old).map(|bi| (si, bi))).unwrap();
        let want = format!("{:016x}", v2.sections[si].blocks[bi + 1].key);
        if p.key != want || (p.s, p.e) != (an.s, an.e) {
            wrong += 1;
            let at = |k: &str| v2.sections.iter().flat_map(|s| &s.blocks).position(|b| format!("{:016x}", b.key) == k);
            eprintln!("misplaced {:?}: pre {:?} suf {:?} pos {:?} -> block #{:?} (want #{:?}) {}..{}", p.how, an.prefix, an.suffix, an.pos, at(&p.key), at(&want), p.s, p.e);
        }
    }
    assert_eq!(wrong, 0, "{wrong} of {} notes on \"{phrase}\" landed on another occurrence", found.len());
}
