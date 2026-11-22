// typeset.js imported into a site's own script (a bundler's, or a module of its own): the
// reader's folder is not beside this file then, but where `npx typeset.js` put it, served as
// /typeset/; serveFrom names another before any book is shown.
import { serveFrom } from './reader/typeset.js';
serveFrom('/typeset/');
export { open, serveFrom } from './reader/typeset.js';
