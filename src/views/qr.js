'use strict';

const { page, esc } = require('./layout');

function warning({ here, configured, forced }) {
  if (forced) {
    return `<div class="warn no-print">
      <strong>The codes below point to ${esc(here)}</strong> – the address you are browsing.
      The <span class="mono">PUBLIC_BASE_URL</span> environment variable still says
      <span class="mono">${esc(configured)}</span>. Remove or correct that variable in
      Railway, or it applies again the next time the page is opened without
      <span class="mono">?base=here</span>.
    </div>`;
  }
  return `<div class="warn no-print">
    <strong>Check the address before you print.</strong>
    The codes below point to <span class="mono">${esc(configured)}</span>, but you are reading
    this page at <span class="mono">${esc(here)}</span>. If the first address is wrong,
    the printed codes lead nowhere.
    <div style="margin-top:10px">
      <a class="btn btn-primary" href="/qr?base=here">Use ${esc(here)} instead</a>
    </div>
    <p style="margin:10px 0 0">
      Permanent fix: Railway → the app's service → <em>Variables</em> → remove
      <span class="mono">PUBLIC_BASE_URL</span> (the address the request came in on is then used),
      or set it to the right address.
    </p>
  </div>`;
}

function qrPage({ cards, baseUrl, mismatch }) {
  // The printed card stays Swedish: it hangs in the cab and the driver reads it.
  const grid = cards.map(c => `<div class="qr-card">
      <div class="qr-title">Säkerhetskontroll</div>
      <img src="${c.dataUrl}" alt="QR code ${esc(c.plate)}">
      <div class="qr-plate">${esc(c.plate)}</div>
      <div class="qr-sub">${esc(c.url)}</div>
    </div>`).join('\n');

  const body = `  <div class="page-head">
    <h1>QR codes</h1>
  </div>
${mismatch ? warning(mismatch) : ''}
  <p class="lede no-print">
    One code per vehicle. Scanning opens the safety check for that vehicle.
    Print the page, cut out and put each code in its cab. The cards themselves stay in
    Swedish, for the drivers.<br>
    Address encoded: <span class="mono">${esc(baseUrl)}/v/&lt;REGNR&gt;</span>
  </p>
  <div class="actions no-print" style="justify-content:flex-start">
    <button class="btn btn-primary" type="button" onclick="window.print()">Print</button>
    <a class="btn btn-ghost" href="/">Back</a>
  </div>

  <div class="qr-grid">
${grid}
  </div>

  <p class="lede no-print" style="margin-top:24px">
    A single code as PNG: <span class="mono">${esc(baseUrl)}/qr/&lt;REGNR&gt;.png</span>
  </p>`;

  return page({ title: 'QR codes – safety check', body, lang: 'en', admin: true,
    links: [{ href: '/', text: 'Vehicles' }, { href: '/admin', text: 'Admin' }] });
}

module.exports = { qrPage };
