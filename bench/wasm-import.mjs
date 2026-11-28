// Imports files with the web build's own engine (the WebAssembly one, 32-bit, as a phone
// runs it), each in a fresh instance, and reports faults; with a count, damaged copies too.
//   node bench/wasm-import.mjs [rounds] file...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const wasmBytes = readFileSync(new URL('../app/src/core/pkg/typeset_wasm_bg.wasm', import.meta.url));
let k = 0;
async function fresh() {
  const m = await import(`../app/src/core/pkg/typeset_wasm.js?i=${k++}`);
  const out = m.initSync({ module: wasmBytes });
  m.catchPanics();
  return { m, eng: new m.Engine(), mem: () => out.memory.buffer.byteLength };
}
const origErr = console.error;
console.error = () => {};
let args = process.argv.slice(2);
const rounds = /^\d+$/.test(args[0] ?? '') ? +args.shift() : 0;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0);
let inst = await fresh();
const faults = new Map();
for (const f of args) {
  const src = readFileSync(f),
    name = basename(f);
  const tries = [['whole', src]];
  for (let i = 0; i < rounds; i++) {
    const b = Buffer.from(src);
    if (i % 2) {
      for (let j = 0; j < 1 + (rnd() % 8); j++) b[rnd() % b.length] = rnd() & 255;
      tries.push(['flip', b]);
    } else tries.push(['cut', b.subarray(0, rnd() % b.length)]);
  }
  for (const [how, b] of tries) {
    const t = performance.now();
    try {
      const id = inst.eng.import(new Uint8Array(b), name);
      if (how === 'whole') {
        const book = JSON.parse(inst.eng.bookJson(id));
        const saved = inst.eng.save(id);
        console.log(
          `${name}: ok, ${book.sections.length} sections, ${(saved.length / 1048576).toFixed(1)} MB saved, ${(inst.mem() / 1048576).toFixed(0)} MB memory, ${(performance.now() - t).toFixed(0)} ms`,
        );
      }
      inst.eng.forget(id);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        const msg = inst.m.lastPanic() || `${e.message} (${(inst.mem() / 1048576).toFixed(0)} MB)`;
        const ent = faults.get(msg) ?? { n: 0, first: `${name}: ${how}` };
        ent.n++;
        faults.set(msg, ent);
        inst = await fresh();
      } else if (how === 'whole') console.log(`${name}: error ${e.message}`);
    }
  }
}
console.error = origErr;
for (const [msg, { n, first }] of faults) console.log(`${n}× ${msg}\n   first: ${first}`);
if (!faults.size) console.log('no faults');
