'use strict';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

const STOCKHOLM = 'Europe/Stockholm';

function fmtDateTime(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: STOCKHOLM, dateStyle: 'short', timeStyle: 'short'
  }).format(new Date(d));
}

const FAVICON =
  'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="15" fill="#1b6ec2"/>' +
    '<circle cx="16" cy="16" r="6" fill="#fff"/></svg>');

function navbar(links) {
  const items = (links || [])
    .map(l => `<a href="${esc(l.href)}">${esc(l.text)}</a>`).join('');
  return `<div class="navbar">
  <a class="brand" href="/">
    <div class="brand-mark"><span></span></div>
    <div class="brand-text">FLEET<em>180</em></div>
  </a>
  <div class="op-badge">instabox</div>
  <div class="navlinks">${items}</div>
</div>`;
}

function page({ title, body, links, bodyClass = '', head = '', scripts = '' }) {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/app.css">
${head}
</head>
<body class="${esc(bodyClass)}">
${navbar(links)}
<div class="wrap">
${body}
</div>
<footer>© ${new Date().getFullYear()} - Fleet 180 · Säkerhetskontroll</footer>
${scripts}
</body>
</html>`;
}

module.exports = { page, esc, fmtDateTime };
