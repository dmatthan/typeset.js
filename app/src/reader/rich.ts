/** Rich blocks (ingest's rich.rs): what the press cannot set from text (a genealogy drawn
 *  as a table, a figure in SVG, a formula), kept as XHTML and drawn here as a picture: an
 *  SVG whose `foreignObject` holds the markup, so the browser lays it out as the
 *  publisher made it, runs nothing in it, and scales it like any image (in the column,
 *  and large in the lightbox). Ink on transparent, in a common serif (a picture cannot
 *  load the app's faces); dark papers invert it (reader.css). */

/** An image's type when it is a rich block. */
export const RICH = 'application/xhtml+xml';

/** Widest a rich block is laid out at before the column scales it down. */
const MAX_W = 900;
const FACE = `font: 16px/1.4 Georgia, 'Times New Roman', serif; color: #111;`;

/** Their natural sizes in CSS px: each as wide as it wants up to MAX_W, as tall as it
 *  then is. Laid out in a frame of their own that runs nothing and fetches nothing
 *  (sandboxed without scripts, under a policy of its own), never in this page: the markup
 *  is the book's, and only its drawing (`richURL`, an image) is inert by itself. */
export async function measureRich(xhtmls: string[]): Promise<{ w: number; h: number }[]> {
  const frame = document.createElement('iframe');
  frame.sandbox.value = 'allow-same-origin';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:absolute;left:-20000px;top:0;width:${MAX_W + 40}px;height:100px;border:0;visibility:hidden`;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body style="margin:0">`;
  const loaded = new Promise(r => frame.addEventListener('load', r, { once: true }));
  document.body.append(frame);
  try {
    await loaded;
    const body = frame.contentDocument!.body;
    return xhtmls.map(x => {
      body.innerHTML = `<div style="${FACE} width:max-content;max-width:${MAX_W}px;display:flow-root">${x}</div>`;
      const r = body.firstElementChild!.getBoundingClientRect();
      return { w: Math.max(24, Math.ceil(r.width)), h: Math.max(24, Math.ceil(r.height)) };
    });
  } finally {
    frame.remove();
  }
}

/** The picture, as a blob URL. */
export function richURL(xhtml: string, w: number, h: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="${FACE} width:${w}px;display:flow-root">${xhtml}</div></foreignObject></svg>`;
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}
