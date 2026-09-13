'use strict';

/**
 * Serving the Checklist Calendar's own pages, unchanged, from inside Fleet 180.
 *
 * The files in `calendar/` are byte-for-byte copies of
 * `prog/checklist-calendar-railway-fresh/public/`. They are deliberately NOT
 * edited: the calendar he works in every morning and the copy on Railway have
 * to stay the same page, and a fork that drifts is worse than no copy at all.
 * `scripts/sync-calendar-assets.js` re-copies them when the original changes.
 *
 * The one thing those files assume is that they sit at the root of a site:
 * `<link href="/styles.css">`, `fetch('/api/checklists')`, `href="/"`. Here
 * they sit under `/kalender`. Rather than rewrite eleven fetch calls and six
 * tags in his source, the paths are rewritten as the file goes out:
 *
 *  - HTML: every `src="/x"` / `href="/x"` gains the prefix, and a small script
 *    is injected in front of everything else.
 *  - That script wraps `fetch` so a request for `/api/...` goes to
 *    `/kalender/api/...`. Nothing else is touched — a page that asks for
 *    `https://…` or a relative path is left alone.
 *
 * Both rewrites are pinned by tests: if he adds a stylesheet or a new endpoint
 * to the calendar, the copy picks it up without anybody remembering this file.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'calendar');
const MOUNT = '/kalender';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/* The calendar asks for the extension's eagle at /icons/eagle.png, which on his
   machine is resolved two folders up. Here it is one file beside the rest. */
const ALIASES = { '/icons/eagle.png': '/eagle.png' };

/**
 * Sent before the calendar's own scripts, so every later `fetch` is already
 * pointed at the right place. Deliberately tiny and synchronous: `theme.js`
 * runs in <head> and calls the API immediately.
 */
const SHIM = `<script>(function(){
  var base = ${JSON.stringify(MOUNT)};
  var real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.charAt(0) === '/' && input.indexOf(base + '/') !== 0) {
      input = base + input;
    } else if (input && input.url && typeof input.url === 'string' &&
               input.url.charAt(0) === '/' && input.url.indexOf(base + '/') !== 0) {
      input = new Request(base + input.url, input);
    }
    return real(input, init);
  };
  window.CALENDAR_BASE = base;
})();</script>`;

/** `src="/app.js"` -> `src="/kalender/app.js"`, leaving `//host` alone. */
function reroot(html) {
  return html.replace(/\b(src|href)="(\/[^"/][^"]*|\/)"/g, (m, attr, url) => {
    const aliased = ALIASES[url] || url;
    return `${attr}="${MOUNT}${aliased === '/' ? '/' : aliased}"`;
  });
}

function dress(html) {
  const rerooted = reroot(html);
  const head = rerooted.indexOf('<head>');
  if (head < 0) return SHIM + rerooted;
  return rerooted.slice(0, head + 6) + '\n' + SHIM + rerooted.slice(head + 6);
}

/* One read per file per boot. These are static assets in the image, so a
   change means a deploy, and a deploy means a new process. */
const cache = new Map();

function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const full = path.join(DIR, rel);
  // Refuse anything that climbed out of the folder.
  if (!full.startsWith(DIR + path.sep)) return null;
  let body;
  try { body = fs.readFileSync(full); } catch (err) { return null; }
  const ext = path.extname(rel).toLowerCase();
  const out = {
    type: TYPES[ext] || 'application/octet-stream',
    body: ext === '.html' ? Buffer.from(dress(body.toString('utf8')), 'utf8') : body
  };
  cache.set(rel, out);
  return out;
}

/**
 * Express handler for everything under the mount that is not `/api`.
 * `/kalender` and `/kalender/` both mean index.html.
 */
function serve(req, res, next) {
  let rel = decodeURIComponent(req.path || '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  if (ALIASES[rel]) rel = ALIASES[rel];
  if (rel.includes('\0') || rel.includes('..')) return next();
  const file = load(rel.replace(/^\/+/, ''));
  if (!file) return next();
  res.set('Content-Type', file.type);
  res.set('Cache-Control', rel.endsWith('.html') ? 'no-store' : 'public, max-age=300');
  return res.send(file.body);
}

module.exports = { serve, reroot, dress, MOUNT, DIR };
