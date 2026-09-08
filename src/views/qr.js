'use strict';

const { page, esc } = require('./layout');
const { FORM_TITLE } = require('../form-def');

function qrPage({ cards, baseUrl }) {
  const grid = cards.map(c => `<div class="qr-card">
      <div class="qr-title">${esc(FORM_TITLE)}</div>
      <img src="${c.dataUrl}" alt="QR-kod ${esc(c.plate)}">
      <div class="qr-plate">${esc(c.plate)}</div>
      <div class="qr-sub">${esc(c.url)}</div>
    </div>`).join('\n');

  const body = `  <div class="page-head">
    <h1>QR-koder</h1>
  </div>
  <p class="lede no-print">
    En kod per OKQ8-fordon. Skanning öppnar säkerhetskontrollen för just det fordonet.
    Skriv ut sidan, klipp ut och sätt koden i respektive hytt.<br>
    Adress som kodas: <span class="mono">${esc(baseUrl)}/v/&lt;REGNR&gt;</span>
  </p>
  <div class="actions no-print" style="justify-content:flex-start">
    <button class="btn btn-primary" type="button" onclick="window.print()">Skriv ut</button>
    <a class="btn btn-ghost" href="/">Tillbaka</a>
  </div>

  <div class="qr-grid">
${grid}
  </div>

  <p class="lede no-print" style="margin-top:24px">
    Enskild kod som PNG: <span class="mono">${esc(baseUrl)}/qr/&lt;REGNR&gt;.png</span>
  </p>`;

  return page({ title: 'QR-koder – säkerhetskontroll', body,
    links: [{ href: '/', text: 'Fordon' }, { href: '/admin', text: 'Admin' }] });
}

module.exports = { qrPage };
