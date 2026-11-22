// volumen.page's own script (the page and the privacy page). Four things only:
// - a link meant for the app (a shared book, an invitation, an opened file) arriving here,
//   and an app installed from here before the app moved to /read, go on to the app at
//   once, before anything is drawn;
// - installing: the install section names this device, with its mark, and says how, for
//   it (without the script, a general word and a list).
//   Add to Home Screen and Add to Dock are done from the library itself (/read), so the
//   app, not this page, is what is installed;
// - the book embedded on the page opens on a page of its text;
// - each code block has a button that copies it, and its parts in their colours.
(() => {
  const forApp = () => /^#(b|open|invite)=/.test(location.hash);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (forApp() || (installed && location.pathname === '/')) { location.replace('/read' + location.hash); return; }
  // (and one pasted into the address bar while this page is open: only its fragment changes)
  addEventListener('hashchange', () => { if (forApp()) location.replace('/read' + location.hash); });

  // the browser's own install (Chrome, Edge), offered when it can be
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { deferred = null; show(); });
  async function install() {
    if (!deferred) return false;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null; show();
    return true;
  }

  const ua = navigator.userAgent;
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const device = ios ? (/iPad/.test(ua) || touchMac ? 'ipad' : 'iphone')
    : /Android/.test(ua) ? 'android'
    : /Macintosh/.test(ua) ? 'mac'
    : /Windows/.test(ua) ? 'windows'
    : /Linux|X11|CrOS/.test(ua) ? 'linux' : null;
  const firefox = /Firefox\//.test(ua) && !ios;
  const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !ios;
  const WHERE = { iphone: 'iPhone', ipad: 'iPad', android: 'Android device', mac: 'Mac', windows: 'Windows computer', linux: 'Linux computer' };
  const MARK = { iphone: 'apple', ipad: 'apple', android: 'android', mac: 'apple', windows: 'windows', linux: 'linux' };

  /** What to say for this device and browser. */
  function how() {
    const appOwn = 'It then opens in a window of its own and reads offline.';
    if (ios) return `Open the library in Safari, then tap Share and choose Add to Home Screen. ${appOwn}`;
    if (firefox) return 'Firefox does not install web apps: Volumen works in a tab here, or installs from Chrome or Edge. The desktop app is coming.';
    if (deferred) return `Install it from the browser as an app of its own. ${appOwn}`;
    if (device === 'android') return `In Chrome, open the library and choose Install app from the menu. ${appOwn}`;
    if (device === 'mac' && !chromium) return `Open the library in Safari, then choose File, Add to Dock. ${appOwn}`;
    if (chromium) return `Open the library and use the install button at the right of the address bar. ${appOwn}`;
    return null;
  }

  function mark(svg, os) {
    if (!svg) return;
    svg.querySelector('use').setAttribute('href', '#os-' + os);
    // (an SVG element has no `hidden` property: the attribute itself goes)
    svg.removeAttribute('hidden');
  }

  function show() {
    const $ = id => document.getElementById(id);
    if (!$('here-h')) return;
    const text = how();
    if (device) $('here-h').textContent = `On this ${WHERE[device]}`;
    if (text) $('here-text').textContent = text;
    const btn = $('here-btn');
    btn.hidden = !deferred;
    if (device) mark(btn.querySelector('svg'), MARK[device]);
    btn.onclick = install;
    // without the browser's install, the library is where it is done
    $('here-open').classList.toggle('main', !deferred);
    // the desktop app for this computer first
    const desk = { mac: 'mac', windows: 'windows', linux: 'linux' }[device];
    const mine = desk && document.querySelector(`#downloads [data-os="${desk}"]`);
    if (mine) { mine.classList.add('mine'); mine.parentElement.prepend(mine); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();

  // the book on this page opens at its Imprint (Standard Ebooks' page, with its picture):
  // the book's second page, from 0.0016 to 0.0042 of it in its box (493 by 650), so the
  // middle of that, which is the second page in a book of 290 to 570 pages, whatever the
  // box a phone gives it (a test holds it there)
  addEventListener('typeset-ready', e => { if (e.target.closest?.('.demo')) e.target.goTo({ at: 0.0029 }); }, { once: true });

  // a snippet's parts (tags, attributes, values, commands) in their colours; the text is
  // the same, so what is copied is too
  const TOKENS = /(<\/?)([\w-]+)|([\w-]+)(=)("[^"]*")|(>)|^(npm|npx)\b/gm;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const k = (cls, s) => `<span class="k-${cls}">${esc(s)}</span>`;
  function colour(code) {
    const t = code.textContent;
    let out = '', at = 0;
    for (const m of t.matchAll(TOKENS)) {
      const [, open, tag, attr, , str, close, cmd] = m;
      out += esc(t.slice(at, m.index)) + (open ? k('p', open) + k('tag', tag) : attr ? k('attr', attr) + k('p', '=') + k('str', str) : close ? k('p', close) : k('cmd', cmd));
      at = m.index + m[0].length;
    }
    code.innerHTML = out + esc(t.slice(at));
  }

  function copies() {
    for (const code of document.querySelectorAll('pre.code code, .opts code')) colour(code);
    for (const pre of document.querySelectorAll('pre.code')) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); } catch { return; }
        b.textContent = 'Copied'; b.classList.add('done');
        setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1600);
      };
      pre.append(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', copies); else copies();
})();
