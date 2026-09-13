'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { icon: badgeIcon, badgeText, BADGES, FLOORS } = require('../badges');

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

/** The marks a driver has earned, the same drawings the board shows. */
function marks(row) {
  const list = (row.badges || []).map(key => {
    const t = badgeText(key, 'sv');
    return `<span class="mark" title="${esc(t.name + ' – ' + t.short)}">${badgeIcon(key, 17)}</span>`;
  }).join('');
  return list || '<span class="muted">—</span>';
}

/** mm:ss, for a duration nobody wants to read as 214 seconds. */
function mmss(sec) {
  if (sec === null || sec === undefined) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function statsPage({ stats, from, to, range, epoch, clamped, message, nav }) {
  const ranked = stats.rows.filter(r => r.ranked);
  const unranked = stats.rows.filter(r => !r.ranked);

  const rankedRows = ranked.map((r, i) => `<tr>
      <td class="rank">${i + 1}</td>
      <td><strong>${esc(r.name)}</strong>${r.note ? `<div class="muted" style="font-size:12px">${esc(r.note)}</div>` : ''}</td>
      <td class="mono">${esc(r.done)}/${esc(r.expected)}${r.extra ? `<span class="muted"> +${esc(r.extra)}</span>` : ''}</td>
      <td>${bar(r.completion, scoreTone(r.completion))}</td>
      <td>${r.care === null ? '<span class="muted">—</span>' : bar(r.care, scoreTone(r.care))}</td>
      <td class="mono">${r.medianWords === null ? '—' : esc(r.medianWords) + ' ord'}</td>
      <td class="mono">${r.medianFill === null ? '—' : esc(mmss(r.medianFill))}</td>
      <td class="marks-cell">${marks(r)}</td>
      <td class="mono">${esc(r.flags)}</td>
      <td><strong class="${scoreTone(r.score)}-text">${pct(r.score)}</strong></td>
    </tr>`).join('\n');

  const unrankedRows = unranked.map(r => `<tr>
      <td></td>
      <td>${esc(r.name)}</td>
      <td class="mono">${esc(r.done)}/${esc(r.expected)}${r.extra ? `<span class="muted"> +${esc(r.extra)}</span>` : ''}</td>
      <td colspan="5" class="muted">${esc(r.note)}</td>
      <td class="marks-cell">${marks(r)}</td>
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

  ${epoch ? `<div class="warn no-print">Statistiken är nollställd och räknas från
     <strong>${esc(epoch)}</strong>.${clamped
       ? ' Datumet du valde ligger före den linjen, så perioden börjar vid linjen i stället.'
       : ''} Kontrollerna före linjen finns kvar – de räknas bara inte med.</div>` : ''}

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
        <th>Omsorg</th><th>Kommentar</th><th>Tid</th><th>Märken</th>
        <th>Rapporterat</th><th>Poäng</th>
      </tr></thead>
      <tbody>
${rankedRows || '<tr><td colspan="10" class="muted" style="padding:18px">Ingen förare har ännu nog många tilldelningar.</td></tr>'}
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
      <p><strong>Tid</strong> är medianen av hur länge formuläret var öppet, från att
         det laddades till att det skickades. Den räknas bara när den kan betyda något:
         en sida som stått öppen i timmar, eller en inskickning som aldrig gick genom
         formuläret, får inget värde alls i stället för ett litet eller ett stort.
         ${stats.medianFill === null
           ? `Fleet 180 har ännu inte ${esc(stats.minTimedChecks)} mätta kontroller, så tidsmärket delas inte ut till någon.`
           : `Flottans median är just nu <span class="mono">${esc(mmss(stats.medianFill))}</span> över ${esc(stats.totals.timedChecks)} mätta kontroller.`}</p>
      <p><strong>Märkena</strong> säger något procenten inte kan: att kontrollen fylldes
         i av någon som tittade. Inget märke är negativt – det finns ingen ikon för en
         slarvig kontroll, för en tavla som skämmer ut folk blir en tavla man lurar.
         Ett märke som inte delats ut betyder oftast att det inte fanns något att dela
         ut det för.</p>
      <ul class="badge-legend">
${BADGES.map(b => `        <li><span class="mark">${badgeIcon(b.key, 18)}</span>
          <span><strong>${esc(b.sv.name)}</strong> – ${esc(b.sv.short)}
          <span class="muted">Krävs minst ${esc(FLOORS[b.key])} tillfällen.</span></span></li>`).join('\n')}
      </ul>
      <p class="muted">Färre än ${esc(stats.minAssignments)} tilldelningar ger ingen ranking.
         En procentsats över två eller tre dagar säger mer om slumpen än om vanan, och
         den sortens siffra bör inte ligga till grund för ett samtal med en förare.</p>
    </div>
  </div>

  <div class="card card-warn no-print">
    <div class="card-header">Nollställ statistiken</div>
    <div class="card-body">
      ${epoch ? `<p>Statistiken räknas just nu <strong>från ${esc(epoch)}</strong>.
           Allt som hände dessförinnan finns kvar i databasen men räknas inte med.</p>
         <form method="post" action="/admin/stats/reset/clear" style="margin-bottom:10px">
           <button class="btn btn-secondary" type="submit">Ta bort nollställningen</button>
         </form>`
        : '<p>Ingen nollställning är satt – all historik räknas.</p>'}
      <p class="muted">En nollställning är ett <strong>datum</strong>, inte en radering:
         poäng, procent och märken börjar räknas om från den dagen, medan kontrollerna,
         fotona och mätarhistoriken ligger kvar. Bilarnas historik och dagsmejlet
         påverkas inte, och linjen går att flytta eller ta bort igen.</p>
      <a class="btn btn-danger" href="/admin/stats/reset">Nollställ …</a>
    </div>
  </div>`;

  return page({ title: 'Förarstatistik', body: html, links: LINKS });
}

/**
 * The confirmation page for a reset.
 *
 * It says the size of what is about to stop counting before it stops counting,
 * and it makes the admin type the word: a reset is one click away from a
 * conversation with a driver about a percentage that no longer means what it
 * meant yesterday.
 */
function statsResetPage({ epoch, date, counts, nav }) {
  const html = `  <div class="page-head">
    <h1>Nollställ statistiken</h1>
    <div class="muted">Räkna om från och med en viss dag</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">Vad som händer</div>
    <div class="card-body">
      <p>Från och med den dag du väljer börjar <strong>genomförande, omsorg, poäng,
         märken och ställningen på förarnas formulär</strong> räknas om från noll.</p>
      <p><strong>Ingenting raderas.</strong> ${esc(counts.submissions)} kontroller och
         ${esc(counts.assignments)} tilldelningar från tiden före
         <span class="mono">${esc(date)}</span> ligger kvar i databasen med sina foton,
         kommentarer och mätarställningar. De syns fortfarande under Kontroller, i
         bilarnas historik och i dagsmejlet – de räknas bara inte med i statistiken.
         ${counts.firstSubmission
           ? `Den äldsta är från ${esc(fmtDateTime(counts.firstSubmission))}.` : ''}</p>
      <p>Vill du ha statistiken tillbaka tar du bort nollställningen igen, och alla
         siffror kommer tillbaka precis som de var.</p>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Bekräfta</div>
    <div class="card-body">
      <form method="post" action="/admin/stats/reset" class="stack-form">
        <label class="q-lab" for="date">Räkna statistiken från och med</label>
        <input class="form-control" type="date" id="date" name="date" value="${esc(date)}" required
               style="max-width:220px">
        <label class="q-lab" for="confirm">Skriv <span class="mono">NOLLSTÄLL</span> för att bekräfta</label>
        <input class="form-control" type="text" id="confirm" name="confirm" autocomplete="off"
               placeholder="NOLLSTÄLL" required style="max-width:220px">
        <div class="actions" style="justify-content:flex-start">
          <a class="btn btn-ghost" href="/admin/stats">Avbryt</a>
          <button class="btn btn-danger" type="submit">Nollställ statistiken</button>
        </div>
      </form>
      ${epoch ? `<p class="muted">Nuvarande nollställning: ${esc(epoch)}. Den här ersätter den.</p>` : ''}
    </div>
  </div>`;

  return page({ title: 'Nollställ statistiken', body: html, links: LINKS });
}

module.exports = { statsPage, statsResetPage };
