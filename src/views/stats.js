'use strict';

const { page, esc, fmtDateTime } = require('./layout');

const LINKS = [
  { href: '/', text: 'Fordon' },
  { href: '/qr', text: 'QR-koder' },
  { href: '/admin', text: 'Admin' }
];

function pct(x) { return x === null || x === undefined ? '—' : Math.round(x * 100) + '%'; }

/** A short bar reads faster than a number when you are scanning 40 rows. */
function bar(x, tone) {
  if (x === null || x === undefined) return '<span class="muted">—</span>';
  const w = Math.max(2, Math.round(x * 100));
  return `<span class="statbar" title="${pct(x)}"><span class="statbar-fill ${tone}" style="width:${w}%"></span></span>` +
    `<span class="statbar-num">${pct(x)}</span>`;
}

function scoreTone(score) {
  if (score === null) return '';
  if (score >= 0.85) return 'good';
  if (score >= 0.6) return 'ok';
  return 'bad';
}

function statsPage({ stats, from, to, range, message, nav }) {
  const ranked = stats.rows.filter(r => r.ranked);
  const unranked = stats.rows.filter(r => !r.ranked);

  const rankedRows = ranked.map((r, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td><strong>${esc(r.name)}</strong>${r.note ? `<div class="muted" style="font-size:12px">${esc(r.note)}</div>` : ''}</td>
      <td class="mono">${esc(r.done)}/${esc(r.expected)}${r.extra ? `<span class="muted"> +${esc(r.extra)}</span>` : ''}</td>
      <td>${bar(r.completion, scoreTone(r.completion))}</td>
      <td>${r.care === null ? '<span class="muted">—</span>' : bar(r.care, scoreTone(r.care))}</td>
      <td class="mono">${r.medianWords === null ? '—' : esc(r.medianWords) + ' ord'}</td>
      <td class="mono">${esc(r.flags)}</td>
      <td><strong class="${scoreTone(r.score)}-text">${pct(r.score)}</strong></td>
    </tr>`).join('\n');

  const unrankedRows = unranked.map(r => `<tr>
      <td></td>
      <td>${esc(r.name)}</td>
      <td class="mono">${esc(r.done)}/${esc(r.expected)}${r.extra ? `<span class="muted"> +${esc(r.extra)}</span>` : ''}</td>
      <td colspan="4" class="muted">${esc(r.note)}</td>
      <td></td>
    </tr>`).join('\n');

  const empty = !stats.rows.length;

  const html = `  <div class="page-head">
    <h1>Förarstatistik</h1>
    <div class="muted">${esc(from)} – ${esc(to)}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <form class="filters no-print" method="get" action="/admin/stats">
    <div class="f"><label for="from">Från</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(from)}"></div>
    <div class="f"><label for="to">Till</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(to)}"></div>
    <button class="btn btn-primary" type="submit">Visa</button>
    <a class="btn btn-ghost" href="/admin/stats">Hela perioden</a>
    <a class="btn btn-secondary" href="/admin/stats.csv?from=${esc(from)}&to=${esc(to)}">Ladda ner CSV</a>
  </form>

  ${empty ? `<div class="warn">
      Ingen statistik ännu. Den bygger på <strong>tilldelningarna</strong> från Route Suite –
      vem som skulle köra vilken bil vilken dag – och de synkas med
      <span class="mono">node scripts/sync-assignments.js</span>.
      ${range && range.n ? `Just nu finns tilldelningar ${esc(range.first)} – ${esc(range.last)}.`
        : 'Inga tilldelningar är synkade ännu.'}
    </div>` : `
  <div class="card">
    <div class="card-header">Sammanlagt
      <span class="step-tag">${esc(stats.totals.done)} av ${esc(stats.totals.expected)} kontroller gjorda
        (${pct(stats.totals.completion)}) · ${esc(stats.totals.ranked)} av ${esc(stats.totals.drivers)} förare har
        underlag nog att rankas</span></div>
  </div>

  <div class="card">
    <div class="card-header">Rankade förare
      <span class="step-tag">Poäng = 70 % genomförande + 30 % omsorg. Sorterat på poäng.</span></div>
    <table class="table">
      <thead><tr>
        <th>#</th><th>Förare</th><th>Gjorda</th><th>Genomförande</th>
        <th>Omsorg</th><th>Kommentar</th><th>Rapporterat</th><th>Poäng</th>
      </tr></thead>
      <tbody>
${rankedRows || '<tr><td colspan="8" class="muted" style="padding:18px">Ingen förare har ännu nog många tilldelningar.</td></tr>'}
      </tbody>
    </table>
  </div>

  ${unranked.length ? `<div class="card">
    <div class="card-header">För lite underlag
      <span class="step-tag">Färre än ${esc(stats.minAssignments)} tilldelningar i perioden – visas men rankas inte</span></div>
    <table class="table"><tbody>
${unrankedRows}
    </tbody></table>
  </div>` : ''}
  `}

  <div class="card">
    <div class="card-header">Så räknas det</div>
    <div class="card-body">
      <p><strong>Genomförande</strong> är antalet gjorda kontroller delat med antalet
         tilldelade fordon i perioden. Tilldelningarna kommer från ruttilldelningen i
         Route Suite, så en dag utan tilldelning räknas inte mot någon. Kontroller på
         bilar föraren inte var tilldelad (<span class="muted">+n</span> i kolumnen
         Gjorda) räknas aldrig som minus – bara som extra.</p>
      <p><strong>Omsorg</strong> mäts bara där det fanns något att vara noggrann med:
         när ett svar flaggar ett problem, skrev föraren <em>vad</em> som var fel, och
         följde det ett foto när det gällde skada eller varningslampa? Andelen sådana
         tillfällen som togs väger 60 %, hur utförliga kommentarerna är väger 40 %
         (mätt som medianen av antal ord, mättad vid åtta). En förare vars bilar aldrig
         haft något fel får inget omsorgsvärde alls – det finns inget att mäta, och en
         nolla eller en hundra hade varit en gissning.</p>
      <p><strong>Poängen</strong> väger genomförande 70 % och omsorg 30 %: att lämna in
         kontrollen alls är det som spelar störst roll. Saknas omsorgsvärde är poängen
         bara genomförandet.</p>
      <p class="muted">Färre än ${esc(stats.minAssignments)} tilldelningar ger ingen ranking.
         En procentsats över två eller tre dagar säger mer om slumpen än om vanan, och
         den sortens siffra bör inte ligga till grund för ett samtal med en förare.</p>
    </div>
  </div>`;

  return page({ title: 'Förarstatistik', body: html, links: LINKS });
}

module.exports = { statsPage };
