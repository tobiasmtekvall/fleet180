'use strict';

const { page, esc, fmtDateTime } = require('./layout');
const { icon: badgeIcon, badgeText, BADGES, FLOORS } = require('../badges');

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
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
    const t = badgeText(key, 'en');
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
      <td class="mono">${r.medianWords === null ? '—' : esc(r.medianWords) + ' words'}</td>
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
    <h1>Driver statistics</h1>
    <div class="muted">${esc(from)} – ${esc(to)}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <form class="filters no-print" method="get" action="/admin/stats">
    <div class="f"><label for="from">From</label>
      <input class="form-control" type="date" id="from" name="from" value="${esc(from)}"></div>
    <div class="f"><label for="to">To</label>
      <input class="form-control" type="date" id="to" name="to" value="${esc(to)}"></div>
    <button class="btn btn-primary" type="submit">Show</button>
    <a class="btn btn-ghost" href="/admin/stats">Whole period</a>
    <a class="btn btn-secondary" href="/admin/stats.csv?from=${esc(from)}&to=${esc(to)}">Download CSV</a>
  </form>

  ${epoch ? `<div class="warn no-print">The statistics have been reset and count from
     <strong>${esc(epoch)}</strong>.${clamped
       ? ' The date you chose is before that line, so the period starts at the line instead.'
       : ''} The checks before the line are kept – they just are not counted.</div>` : ''}

  ${empty ? `<div class="warn">
      No statistics yet. They are built on the <strong>assignments</strong> from Route Suite –
      who was to drive which van on which day – and those are synced with
      <span class="mono">node scripts/sync-assignments.js</span>.
      ${range && range.n ? `Assignments currently cover ${esc(range.first)} – ${esc(range.last)}.`
        : 'No assignments have been synced yet.'}
    </div>` : `
  <div class="card">
    <div class="card-header">In total
      <span class="step-tag">${esc(stats.totals.done)} of ${esc(stats.totals.expected)} checks done
        (${pct(stats.totals.completion)}) · ${esc(stats.totals.ranked)} of ${esc(stats.totals.drivers)} drivers have
        enough to be ranked</span></div>
  </div>

  <div class="card">
    <div class="card-header">Ranked drivers
      <span class="step-tag">Score = 70 % completion + 30 % care. Sorted by score.</span></div>
    <table class="table">
      <thead><tr>
        <th>#</th><th>Driver</th><th>Done</th><th>Completion</th>
        <th>Care</th><th>Comment</th><th>Time</th><th>Badges</th>
        <th>Reported</th><th>Score</th>
      </tr></thead>
      <tbody>
${rankedRows || '<tr><td colspan="10" class="muted" style="padding:18px">No driver has enough assignments yet.</td></tr>'}
      </tbody>
    </table>
  </div>

  ${unranked.length ? `<div class="card">
    <div class="card-header">Too little to go on
      <span class="step-tag">Fewer than ${esc(stats.minAssignments)} assignments in the period – shown but not ranked</span></div>
    <table class="table"><tbody>
${unrankedRows}
    </tbody></table>
  </div>` : ''}
  `}

  <div class="card">
    <div class="card-header">How it is calculated</div>
    <div class="card-body">
      <p><strong>Completion</strong> is the number of checks done divided by the number of
         vehicles assigned in the period. The assignments come from the route assignment in
         Route Suite, so a day without an assignment counts against nobody. Checks on
         vans the driver was not assigned (<span class="muted">+n</span> in the Done
         column) never count as a minus – only as extra.</p>
      <p><strong>Care</strong> is only measured where there was something to be careful about:
         when an answer flags a problem, did the driver write <em>what</em> was wrong, and
         did a photo follow when it concerned damage or a warning light? The share of such
         occasions taken counts 60 %, how thorough the comments are counts 40 %
         (measured as the median word count, capped at eight). A driver whose vans never
         had anything wrong gets no care value at all – there is nothing to measure, and a
         zero or a hundred would have been a guess.</p>
      <p><strong>The score</strong> weighs completion 70 % and care 30 %: filing the check
         at all is what matters most. Without a care value the score is completion
         alone.</p>
      <p><strong>Time</strong> is the median of how long the form was open, from when it
         loaded to when it was sent. It only counts when it can mean something:
         a page left open for hours, or a submission that never went through the
         form, gets no value at all rather than a small or a large one.
         ${stats.medianFill === null
           ? `Fleet 180 does not yet have ${esc(stats.minTimedChecks)} timed checks, so the time badge is not awarded to anyone.`
           : `The fleet median is currently <span class="mono">${esc(mmss(stats.medianFill))}</span> over ${esc(stats.totals.timedChecks)} timed checks.`}</p>
      <p><strong>The badges</strong> say something the percentages cannot: that the check was
         filled in by somebody who looked. No badge is negative – there is no icon for a
         sloppy check, because a board that shames people becomes a board people game.
         A badge not awarded usually means there was nothing to award it for.
         The drivers see the badges in Swedish on their form.</p>
      <ul class="badge-legend">
${BADGES.map(b => `        <li><span class="mark">${badgeIcon(b.key, 18)}</span>
          <span><strong>${esc(b.en.name)}</strong> <span class="muted">(${esc(b.sv.name)})</span> – ${esc(b.en.short)}
          <span class="muted">Needs at least ${esc(FLOORS[b.key])} occasions.</span></span></li>`).join('\n')}
      </ul>
      <p class="muted">Fewer than ${esc(stats.minAssignments)} assignments give no ranking.
         A percentage over two or three days says more about chance than about habit, and
         that kind of figure should not be the basis of a conversation with a driver.</p>
    </div>
  </div>

  <div class="card card-warn no-print">
    <div class="card-header">Reset the statistics</div>
    <div class="card-body">
      ${epoch ? `<p>The statistics currently count <strong>from ${esc(epoch)}</strong>.
           Everything before that is still in the database but is not counted.</p>
         <form method="post" action="/admin/stats/reset/clear" style="margin-bottom:10px">
           <button class="btn btn-secondary" type="submit">Remove the reset</button>
         </form>`
        : '<p>No reset is set – all history counts.</p>'}
      <p class="muted">A reset is a <strong>date</strong>, not a deletion:
         scores, percentages and badges start counting again from that day, while the checks,
         the photos and the odometer history stay. The vans' history and the daily email
         are not affected, and the line can be moved or removed again.</p>
      <a class="btn btn-danger" href="/admin/stats/reset">Reset …</a>
    </div>
  </div>`;

  return page({ title: 'Driver statistics', body: html, links: LINKS, lang: 'en', admin: true });
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
    <h1>Reset the statistics</h1>
    <div class="muted">Count again from a given day</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">What happens</div>
    <div class="card-body">
      <p>From the day you choose, <strong>completion, care, score, badges and the
         standings on the drivers' form</strong> start counting again from zero.</p>
      <p><strong>Nothing is deleted.</strong> ${esc(counts.submissions)} checks and
         ${esc(counts.assignments)} assignments from before
         <span class="mono">${esc(date)}</span> stay in the database with their photos,
         comments and odometer readings. They still show under Checks, in the vans'
         history and in the daily email – they are just not counted in the statistics.
         ${counts.firstSubmission
           ? `The oldest is from ${esc(fmtDateTime(counts.firstSubmission))}.` : ''}</p>
      <p>If you want the statistics back, remove the reset again and every figure
         comes back exactly as it was.</p>
    </div>
  </div>

  <div class="card">
    <div class="card-header">Confirm</div>
    <div class="card-body">
      <form method="post" action="/admin/stats/reset" class="stack-form">
        <label class="q-lab" for="date">Count the statistics from</label>
        <input class="form-control" type="date" id="date" name="date" value="${esc(date)}" required
               style="max-width:220px">
        <label class="q-lab" for="confirm">Type <span class="mono">RESET</span> to confirm</label>
        <input class="form-control" type="text" id="confirm" name="confirm" autocomplete="off"
               placeholder="RESET" required style="max-width:220px">
        <div class="actions" style="justify-content:flex-start">
          <a class="btn btn-ghost" href="/admin/stats">Cancel</a>
          <button class="btn btn-danger" type="submit">Reset the statistics</button>
        </div>
      </form>
      ${epoch ? `<p class="muted">Current reset: ${esc(epoch)}. This one replaces it.</p>` : ''}
    </div>
  </div>`;

  return page({ title: 'Reset the statistics', body: html, links: LINKS, lang: 'en', admin: true });
}

module.exports = { statsPage, statsResetPage };
