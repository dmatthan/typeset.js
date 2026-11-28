/** The wheel and the trackpad, told apart, each turning the page its own way:
 *  - a mouse wheel's notch is a column, every notch (a spin of twelve is twelve), parts of a
 *    notch adding up;
 *  - a trackpad's swipe is a column once it has gone far enough (`SWIPE`), however long it
 *    and its momentum run; a new swipe is the next (a pause, or the fingers pushing again
 *    while the momentum of the last still runs).
 *  Which it is, is read from the events as each gesture begins (`isMouse`), leaning to the
 *  trackpad when unsure, and a "mouse" whose events stop looking like a wheel's is taken for
 *  a trackpad from there on: a mouse taken for a trackpad turns a little less, a trackpad
 *  taken for a mouse turned a page an event. (The trackpad once moved the sheet one to one
 *  and landed it: its momentum, thousands of pixels over a second and more, carried it
 *  several columns a flick.)
 *
 *  Pure of the page: `feed` takes what the events say, `turn` is called with each turn,
 *  `kept` with the log of the gestures last seen (input.ts keeps it: `diag.input`). */

/** One wheel event, as far as this needs it: its delta along its main axis in px, the
 *  delta's unit as the event gave it (0 px, 1 lines, 2 pages), the engine's older
 *  `wheelDelta` along the same axis (0 where it gives none), and its time in ms. */
export interface WheelInput {
  delta: number;
  mode: number;
  legacy: number;
  t: number;
}

/** Without events this long, ms, a gesture is over. */
const QUIET = 200;
/** How far, px, a trackpad's swipe goes before it turns the page: past a brush. */
const SWIPE = 40;
/** After a turn the swipe runs on, rising to its peak, then its momentum falls: once it has
 *  fallen below `FALLEN` of its peak, a push rising `AGAIN` times above the least it fell to
 *  (and `AGAIN_MIN` px at least) is the fingers again, a new swipe. */
const FALLEN = 0.6,
  AGAIN = 2.2,
  AGAIN_MIN = 6;

interface Gesture {
  mouse: boolean;
  t0: number;
  last: number;
  /** A mouse's: notches turned so far, its notch `q`. A trackpad's: px since its swipe began. */
  acc: number;
  q: number;
  /** A trackpad's, once turned: which way, the most and (since then) the least of its speed. */
  turned: boolean;
  dir: number;
  peak: number;
  low: number;
  log: [number, number][];
}

/** Whether an event begins a mouse wheel's gesture: lines or pages (Firefox's wheel); the
 *  engine's wheelDelta in steps of 120, a notch (Chromium's and WebKit's), unless it is three
 *  times the delta (their trackpads' on a Mac); with none, a whole step of 50 px or more (a
 *  webview's: WebKitGTK's is 153), or the notch already known. (An engine's own wheelDelta
 *  points against the delta and is not the delta itself: one that is, rounded, either way,
 *  was made from it, for an event a page made, and says nothing.) */
function isMouse(e: WheelInput, known: number): boolean {
  if (e.mode !== 0) return true;
  const m = Math.abs(e.delta);
  if (known && Math.abs(m - known) < 0.5) return true;
  const made = Math.sign(e.legacy) === Math.sign(e.delta) || Math.abs(e.legacy) === Math.round(m);
  if (e.legacy && !made) return e.legacy !== -3 * e.delta && e.legacy % 120 === 0 && m >= 15;
  return Number.isInteger(e.delta) && m >= 50;
}

/** Whether an event is still a wheel's: its notch, or several at once (a fast spin). */
const notchy = (v: number, q: number) => {
  const n = Math.abs(v) / q;
  return n >= 0.99 && Math.abs(n - Math.round(n)) < 0.01;
};

export class Wheel {
  private g: Gesture | null = null;
  /** The notch of the mouse last seen, px. */
  private notch = 0;
  /** Recent gestures, kept for diagnosis (a real device's events, to tune by). */
  readonly log: { kind: string; events: [number, number][] }[] = [];

  constructor(
    private turn: (d: 1 | -1) => void,
    private kept: (log: Wheel['log']) => void = () => {},
  ) {}

  feed(e: WheelInput) {
    const v = e.delta;
    if (!v) return;
    let g = this.g;
    if (g && e.t - g.last > QUIET) {
      this.keep(g);
      g = null;
    }
    if (!g) g = this.g = this.begin(e);
    if (g.log.length < 60) g.log.push([Math.round(e.t - g.t0), +v.toFixed(2)]);
    g.last = e.t;
    // a "mouse" whose events stop looking like a wheel's is a trackpad, whose page has turned
    if (g.mouse && e.mode === 0 && !notchy(v, g.q))
      Object.assign(g, { mouse: false, turned: true, dir: Math.sign(v), peak: Math.abs(v), low: Math.abs(v) });
    if (g.mouse) this.notches(g, v);
    else this.swipe(g, v);
  }

  private begin(e: WheelInput): Gesture {
    const mouse = isMouse(e, this.notch),
      q = Math.abs(e.delta);
    if (mouse) this.notch = q;
    return { mouse, t0: e.t, last: e.t, acc: 0, q, turned: false, dir: 0, peak: 0, low: Infinity, log: [] };
  }

  /** A mouse: each notch a column, parts of one adding up (a turn at the half, so the wheel
   *  answers at once; the remainder may sit at exactly −½, and only more turns back). */
  private notches(g: Gesture, v: number) {
    g.acc += v / g.q;
    if (Math.abs(g.acc) < 0.5) return;
    do {
      const d = Math.sign(g.acc) as 1 | -1;
      this.turn(d);
      g.acc -= d;
    } while (Math.abs(g.acc) > 0.5);
  }

  /** A trackpad: one turn a swipe; then nothing until the fingers push again. */
  private swipe(g: Gesture, v: number) {
    const m = Math.abs(v);
    if (g.turned) {
      if (m > g.peak) {
        g.peak = g.low = m;
        return;
      }
      g.low = Math.min(g.low, m);
      const again = g.low <= g.peak * FALLEN && m >= g.low * AGAIN && m >= AGAIN_MIN && Math.sign(v) === g.dir;
      if (!again) return;
      Object.assign(g, { turned: false, acc: 0 });
    }
    g.acc += v;
    if (Math.abs(g.acc) < SWIPE) return;
    g.dir = Math.sign(g.acc);
    this.turn(g.dir as 1 | -1);
    Object.assign(g, { turned: true, peak: m, low: m });
  }

  private keep(g: Gesture) {
    this.log.push({ kind: g.mouse ? 'mouse' : 'trackpad', events: g.log });
    if (this.log.length > 30) this.log.shift();
    this.kept(this.log);
  }
}
