'use strict';

const { page, esc } = require('./layout');

function warning({ here, configured, forced }) {
  if (forced) {
    return `<div class="warn no-print">
      <strong>Koderna nedan pekar på ${esc(here)}</strong> – adressen du surfar på.
      Miljövariabeln <span class="mono">PUBLIC_BASE_URL</span> säger fortfarande
      <span class="mono">${esc(configured)}</span>. Ta bort eller rätta den variabeln i
      Railway, annars gäller den igen nästa gång sidan öppnas utan
      <span class="mono">?base=here</span>.
    </div>`;
  }
  return `<div class="warn no-print">
    <strong>Kontrollera adressen innan du skriver ut.</strong>
    Koderna nedan pekar på <span class="mono">${esc(configured)}</span>, men du läser
    den här sidan på <span class="mono">${esc(here)}</span>. Stämmer inte den första
    adressen leder de utskrivna koderna ingenstans.
    <div style="margin-top:10px">
      <a class="btn btn-primary" href="/qr?base=here">Använd ${esc(here)} i stället</a>
    </div>
    <p style="margin:10px 0 0">
      Permanent rättning: Railway → appens service → <em>Variables</em> → ta bort
      <span class="mono">PUBLIC_BASE_URL</span> (då används adressen anropet kom in på),
      eller sätt den till rätt adress.
    </p>
  </div>`;
}

function qrPage({ cards, baseUrl, mismatch }) {
  const grid = cards.map(c => `<div class="qr-card">
      <div class="qr-title">Säkerhetskontroll</div>
      <img src="${c.dataUrl}" alt="QR-kod ${esc(c.plate)}">
      <div class="qr-plate">${esc(c.plate)}</div>
      <div class="qr-sub">${esc(c.url)}</div>
    </div>`).join('\n');

  const body = `  <div class="page-head">
    <h1>QR-koder</h1>
  </div>
${mismatch ? warning(mismatch) : ''}
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
