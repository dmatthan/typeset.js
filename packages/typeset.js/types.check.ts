// The types as a site's script uses them (compiled by scripts/lint.sh; not published).
import { open, serveFrom, type TypesetBook } from './index.js';

serveFrom('/static/reader/');
const { book, close } = open({ src: '/books/a.epub', chapters: '1-3', endHref: '/shop', remember: true });
book.addEventListener('typeset-progress', e => console.log(e.detail.at.toFixed(2)));
book.addEventListener('typeset-ready', e => { if (e.detail.chapters > 3) book.goTo({ chapter: 3 }); });
const b: TypesetBook | null = document.querySelector('typeset-book');
b?.setTheme('linen');
document.querySelector('typeset-open')?.open();
close();
// @ts-expect-error: a book needs its address
open({ chapters: '2' });
