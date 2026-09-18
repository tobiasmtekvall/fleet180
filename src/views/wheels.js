'use strict';
/**
 * Wheels: every van's tyres, both sets, on one page.
 *
 * The question this page answers is one question -- how much tread is left --
 * so the page is one shape repeated: a van, its two sets, two tyres each, and
 * a number in a colour. Everything else (the make, the size, the DOT code,
 * the photos, the note) is folded away behind the set it belongs to, because
 * it is read once a year and the tread is read every month.
 *
 * Clicking a tyre opens its own little form, in place, with no page load and
 * no JavaScript: a <details> whose <summary> IS the tile. That is what makes
 * "click the tyre, type the number" work on a phone in a cold yard, which is
 * where this actually gets used.
 */

const { page, esc, fmtDateTime } = require('./layout');
const wheels = require('../wheels');

const LINKS = [
  { href: '/', text: 'Vehicles' },
  { href: '/qr', text: 'QR codes' },
  { href: '/admin', text: 'Admin' }
];

const SEASON_LABEL = { summer: 'Summer', winter: 'Winter' };
const SEASONS = ['summer', 'winter'];
const POSITION_LABEL = { front: 'Front', back: 'Back' };
const POSITIONS = ['front', 'back'];
const TYPE_LABEL = { '': '—', studded: 'Studded (dubb)', friction: 'Friction' };

/* The two small pictures. Drawn here rather than fetched or copied: they are
   the same tyre seen from the side, and what separates them is what is cut
   into the tread -- straight ribs that push water out of the way in summer,
   and the sipes and the snowflake of a winter tyre. Both use currentColor, so
   the picture is the same green or amber as the number beside it. */
const TYRE_ART = {
  // Straight ribs: the tread that pushes water out from under a summer tyre.
  summer:
    '<svg class="tyreart" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="6"/>' +
    '<path d="M22 14.5v35M32 11v42M42 14.5v35" fill="none" stroke="currentColor"' +
    ' stroke-width="3.4" stroke-linecap="round"/></svg>',
  // The snowflake, as big as the ring allows: at 44 pixels it is the only
  // thing anybody actually reads, so nothing else shares the middle with it.
  winter:
    '<svg class="tyreart" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="6"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round">' +
    '<path d="M32 14v36M16.4 23l31.2 18M16.4 41l31.2-18"/>' +
    '<path d="M27.5 19.5L32 15l4.5 4.5M27.5 44.5L32 49l4.5-4.5"/>' +
    '<path d="M18.6 29.3l-1.7-6.1 6.2-1.7M45.4 34.7l1.7 6.1-6.2 1.7"/>' +
    '<path d="M23.1 42.5l-6.2 1.7 1.7-6.1M40.9 21.5l6.2-1.7-1.7 6.1"/></g></svg>'
};

const ICON = {
  camera: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M3.5 8h4l1.5-2h6L16.5 8h4v11h-17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
};

/** The newest reading for one axle of one set, or null. */
function latest(set, position) {
  const rows = (set.readings || []).filter(r => r.position === position);
  return rows.length ? rows[rows.length - 1] : null;
}

/**
 * One tyre.
 *
 * The tile shows the depth, and the depth decides the colour -- that is the
 * whole page in one element. Opening it reveals the form for the next
 * reading, with today's date already in it and the cursor going straight to
 * the millimetres, because the person holding the gauge is holding a gauge.
 */
function tyreTile(set, position, today, ret) {
  const last = latest(set, position);
  const band = wheels.bandOf(last && last.depth_mm);
  const history = (set.readings || []).filter(r => r.position === position);
  const wear = wheels.wearOf(history, today);
  const id = `${set.plate}-${set.season}-${position}`;

  /* A depth is a measurement, not a property of the tyre: 6 mm last March is
     not 6 mm now. So the tile carries the day it was measured and says so out
     loud once that day is far enough back to be worth doing again -- without
     it, the colour, the row and the fleet tally all quietly present a year-old
     number as the state of the van. */
  const on = last ? wheels.asDay(last.measured_on) : '';
  const age = last ? wheels.daysBetween(on, today) : null;
  const stale = Boolean(last && wheels.isStale(on, today));

  const tip = [
    `${POSITION_LABEL[position]} · ${SEASON_LABEL[set.season]} · ${set.plate}`,
    last ? `${wheels.mm(last.depth_mm)} mm, measured ${on}${
      age === null ? '' : ` (${age} days ago)`}${
      last.measured_by ? ' by ' + last.measured_by : ''}` : 'Never measured',
    stale ? `Older than ${wheels.STALE_DAYS} days – worth putting a gauge on it again.` : '',
    band.hint
  ].filter(Boolean).join('\n');

  return `<details class="tyre band-${esc(band.key)}${stale ? ' stale' : ''}" id="t-${esc(id)}">
    <summary title="${esc(tip)}">
      <span class="tyre-pos">${esc(POSITION_LABEL[position])}</span>
      <span class="tyre-mm">${last ? `${esc(wheels.mm(last.depth_mm))}<em>mm</em>`
        : '<span class="tyre-none">–</span>'}</span>
      <span class="tyre-band">${esc(band.label)}</span>
      <span class="tyre-when">${last
        ? `${esc(on)}${stale ? ` <em title="Measured more than ${wheels.STALE_DAYS} days ago – this number is old">old</em>` : ''}`
        : ''}</span>
    </summary>
    <div class="tyre-body">
      <form method="post" action="/admin/wheels/${esc(set.plate)}/${esc(set.season)}/reading">
        <input type="hidden" name="ret" value="${esc(ret)}">
        <input type="hidden" name="position" value="${esc(position)}">
        <div class="tyre-form">
          ${/* NOT type="number". This document is served in English, and a
                number field under an English locale silently throws away the
                comma a Swede types -- so the field would refuse "6,5" while
                the placeholder beside it asked for exactly that. Text with
                inputmode="decimal" still brings up the number pad on a phone,
                and the server takes either separator. */''}
          <label><span>Tread, mm *</span>
            <input class="form-control" type="text" name="depthMm" required
                   inputmode="decimal" pattern="[0-9]{1,2}([.,][0-9])?" maxlength="5"
                   placeholder="e.g. 6,5"
                   title="Millimetres, to one decimal. A comma or a full stop, either is fine."></label>
          <label><span>Measured</span>
            <input class="form-control" type="date" name="measuredOn" value="${esc(today)}"></label>
          <label><span>By</span>
            <input class="form-control" type="text" name="measuredBy" maxlength="120"
                   autocomplete="name" placeholder="Your name"></label>
          <label class="tyre-note"><span>Note</span>
            <input class="form-control" type="text" name="note" maxlength="500"
                   placeholder="e.g. worn on the inside edge"></label>
          <button class="btn btn-primary btn-sm" type="submit">Save</button>
        </div>
      </form>
      ${historyList(history, wear, ret)}
    </div>
  </details>`;
}

/** What this tyre has measured before, newest first, and where it is going. */
function historyList(history, wear, ret) {
  if (!history.length) return '<p class="muted tyre-hist-empty">No readings yet.</p>';
  /* All of them. "Every reading is kept" is what this page promises, and a
     list that quietly stops at six is not keeping it anywhere anybody looks. */
  const rows = [...history].reverse().map(r => `<li>
      <span class="th-mm band-${esc(wheels.bandOf(r.depth_mm).key)}">${esc(wheels.mm(r.depth_mm))} mm</span>
      <span class="th-on">${esc(wheels.asDay(r.measured_on))}</span>
      <span class="th-by" title="${esc([r.measured_by, r.note].filter(Boolean).join(' · '))}">${
        esc([r.measured_by, r.note].filter(Boolean).join(' · '))}</span>
      <form method="post" action="/admin/wheels/reading/${esc(r.id)}/delete">
        <input type="hidden" name="ret" value="${esc(ret)}">
        <button class="linkx" type="submit"
                title="Delete this reading – for a number typed wrong, not for a tyre that changed">×</button>
      </form>
    </li>`).join('');
  return `<ul class="tyre-hist">${rows}</ul>${wearLine(wear)}`;
}

/** The one sentence a wear rate is worth. */
function wearLine(wear) {
  if (!wear) return '';
  const rate = `<strong>${esc(wheels.mm(wear.perMonth))} mm a month</strong>`;
  if (wear.months === 0) return `<p class="tyre-wear">Wearing ${rate} – already at or under 3 mm.</p>`;
  if (wear.over) return `<p class="tyre-wear">Wearing ${rate} – over a year to 3 mm at this rate.</p>`;
  /* A date in the PAST is the interesting case, not one to clamp to zero: it
     means the last reading is old enough that this tyre went under 3 mm some
     while back, if it has gone on being driven the way it was. "0 days" there
     would turn the one real warning on the page into a shrug. */
  if (wear.passed) {
    return `<p class="tyre-wear warn">At this rate it passed 3 mm around
      <strong>${esc(wear.reaches3)}</strong>, ${esc(Math.abs(wear.daysFromToday))} days ago –
      measure it again before trusting the number above.</p>`;
  }
  return `<p class="tyre-wear">Wearing ${rate} – 3 mm around <strong>${esc(wear.reaches3)}</strong>${
    wear.daysFromToday !== null ? ` (${esc(wear.daysFromToday)} days)` : ''}.</p>`;
}

/** A photo, as a chip next to the set it belongs to. */
function fileChip(f) {
  const when = f.taken_at ? `taken ${fmtDateTime(f.taken_at)}`
    : f.uploaded_at ? `uploaded ${fmtDateTime(f.uploaded_at)}` : '';
  const tip = [f.filename || 'Photo', f.position ? POSITION_LABEL[f.position] : '', when]
    .filter(Boolean).join(' · ');
  return `<span class="wfile">
      <a href="/admin/wheels/file/${esc(f.id)}" target="_blank" rel="noopener"
         title="${esc(tip)}">${ICON.camera}${f.position ? `<em>${esc(POSITION_LABEL[f.position])}</em>` : ''}</a>
      <button class="filex" type="submit" title="Remove ${esc(f.filename || 'this photo')}"
              formaction="/admin/wheels/file/${esc(f.id)}/delete">×</button>
    </span>`;
}

/**
 * One season's block: the picture, what the tyres ARE, and the two tiles.
 *
 * The picture is coloured by the worst of the two tyres, so a van with one
 * bald front tyre is a red tyre on the row whether or not anybody reads the
 * numbers -- which is the point of having a picture at all.
 */
function seasonBlock(plate, season, set, past, fitted, today, ret) {
  const s = set || { plate, season, readings: [], files: [], make: '', model: '',
    size: '', tyre_type: '', dot: '', note: '' };
  const worst = wheels.worstOf(POSITIONS.map(p => {
    const l = latest(s, p);
    return l ? l.depth_mm : null;
  }));
  const spec = [s.make, s.model].filter(Boolean).join(' ');
  const on = fitted === season;

  return `<div class="wseason band-${esc(worst)}${on ? ' fitted' : ''}">
    <div class="wseason-head">
      <span class="wseason-art">${TYRE_ART[season]}</span>
      <span class="wseason-name">${esc(SEASON_LABEL[season])}${
        on ? '<em class="wfitted-tag">on the van</em>' : ''}</span>
      <span class="wseason-spec" title="${esc([spec, s.size, TYPE_LABEL[s.tyre_type] !== '—' ? TYPE_LABEL[s.tyre_type] : '', s.dot ? 'DOT ' + s.dot : ''].filter(Boolean).join(' · ') || 'Nothing recorded about this set')}">${
        spec || s.size ? esc([spec, s.size].filter(Boolean).join(' · '))
          : '<span class="muted">no make recorded</span>'}</span>
    </div>
    <div class="wtyres">${POSITIONS.map(p => tyreTile(s, p, today, ret)).join('')}</div>
    ${setDetails(plate, season, s, today, ret)}
    ${pastSets(past, today)}
  </div>`;
}

/** Make, size, DOT, studded or friction, the note and the photos. */
function setDetails(plate, season, s, today, ret) {
  const filled = [s.make, s.size, s.dot ? 'DOT ' + s.dot : '',
    s.tyre_type ? TYPE_LABEL[s.tyre_type] : '', s.note ? 'note' : '',
    s.files.length ? `${s.files.length} photo${s.files.length === 1 ? '' : 's'}` : '']
    .filter(Boolean);
  return `<details class="wset">
    <summary>Tyres, size and photos${filled.length
      ? ` <span class="muted">· ${esc(filled.join(' · '))}</span>` : ''}</summary>
    <form class="wset-form" method="post" enctype="multipart/form-data"
          action="/admin/wheels/${esc(plate)}/${esc(season)}">
      <input type="hidden" name="ret" value="${esc(ret)}">
      <label><span>Make</span><input class="form-control" type="text" name="make" maxlength="80"
             value="${esc(s.make)}" placeholder="e.g. Continental"></label>
      <label><span>Model</span><input class="form-control" type="text" name="model" maxlength="80"
             value="${esc(s.model)}" placeholder="e.g. VanContact Winter"></label>
      <label><span>Size</span><input class="form-control mono" type="text" name="size" maxlength="40"
             value="${esc(s.size)}" placeholder="235/65 R16C"></label>
      <label><span>Type</span>
        <select class="form-control" name="tyreType">${Object.entries(TYPE_LABEL).map(([v, l]) =>
          `<option value="${esc(v)}"${v === (s.tyre_type || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>
      <label><span>DOT</span><input class="form-control mono" type="text" name="dot" maxlength="8"
             value="${esc(s.dot)}" placeholder="2321"
             title="The four digits on the tyre wall: week and year it was made. Rubber ages whether it is driven on or not."></label>
      <label class="wgrow"><span>Note</span><input class="form-control" type="text" name="note" maxlength="500"
             value="${esc(s.note)}" placeholder="Where the set is stored, who changed it, what the workshop said"></label>
      <label><span>Photos</span><input class="form-control wfileinput" type="file" name="photos"
             accept="image/*" multiple></label>
      <label><span>Of which tyre</span>
        <select class="form-control" name="photoPosition">
          <option value="">The set</option>${POSITIONS.map(p =>
            `<option value="${p}">${esc(POSITION_LABEL[p])}</option>`).join('')}
        </select></label>
      <div class="wset-actions">
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
      </div>
    </form>
    ${s.files.length ? `<form class="wfiles-form" method="post" action="/admin/wheels/file/0/delete">
      <input type="hidden" name="ret" value="${esc(ret)}">
      <span class="wfiles">${s.files.map(fileChip).join('')}</span>
    </form>` : ''}
    ${newSetForm(plate, season, s, today, ret)}
  </details>`;
}

/**
 * New tyres on this end of the van.
 *
 * Not a "clear" button and not an edit: the old set is stamped with the day it
 * came off and keeps its readings, its make and its DOT code, and an empty set
 * takes its place. Measuring new rubber into the old set's history would make
 * every wear figure on the page a lie, and deleting the old readings would
 * throw away the only record of what the last set did.
 */
function newSetForm(plate, season, s, today, ret) {
  const has = s.readings.length || s.make || s.dot;
  return `<form class="wnewset" method="post"
        action="/admin/wheels/${esc(plate)}/${esc(season)}/replace">
      <input type="hidden" name="ret" value="${esc(ret)}">
      <label><span>New set fitted</span>
        <input class="form-control" type="date" name="on" value="${esc(today)}" max="${esc(today)}"></label>
      <button class="btn btn-ghost btn-sm" type="submit"
              title="${has
                ? 'Put this set aside with the day it came off \u2013 it keeps its readings and its make \u2013 and start an empty one'
                : 'There is nothing recorded on this set yet, so there is nothing to put aside'}">New set</button>
      <span class="muted wnewset-hint">The set now on the page is kept, with its readings,
        under <em>Earlier sets</em>.</span>
    </form>`;
}

/** The sets this van has been through, read-only, newest first. */
function pastSets(past, today) {
  if (!past || !past.length) return '';
  const rows = past.map(s => {
    const worst = wheels.worstOf(POSITIONS.map(p => {
      const l = latest(s, p);
      return l ? l.depth_mm : null;
    }));
    const spec = [s.make, s.model, s.size].filter(Boolean).join(' \u00b7 ') || 'no make recorded';
    const ends = POSITIONS.map(p => {
      const l = latest(s, p);
      return `${POSITION_LABEL[p]} ${l ? wheels.mm(l.depth_mm) + ' mm' : '\u2013'}`;
    }).join(' \u00b7 ');
    return `<li class="band-${esc(worst)}">
      <span class="ps-when">to ${esc(wheels.asDay(s.retired_on))}</span>
      <span class="ps-spec" title="${esc([spec, s.dot ? 'DOT ' + s.dot : '', s.note].filter(Boolean).join(' \u00b7 '))}">${esc(spec)}</span>
      <span class="ps-last" title="The last reading on each axle before it came off">${esc(ends)}</span>
      <span class="ps-n">${esc(s.readings.length)} reading${s.readings.length === 1 ? '' : 's'}</span>
    </li>`;
  }).join('');
  return `<details class="wpast">
    <summary>Earlier sets <span class="muted">\u00b7 ${esc(past.length)}</span></summary>
    <ul class="wpast-list">${rows}</ul>
  </details>`;
}

/** Which set is on the van, and since when. */
function fittedForm(v, today, ret) {
  const since = wheels.asDay(v.fitted_since);
  return `<form class="wfitted" method="post" action="/admin/wheels/${esc(v.plate)}/fitted">
      <input type="hidden" name="ret" value="${esc(ret)}">
      <select class="form-control" name="season" title="Which set is on the van now">
        <option value=""${v.fitted_season ? '' : ' selected'}>Not set</option>${SEASONS.map(s =>
          `<option value="${s}"${s === v.fitted_season ? ' selected' : ''}>${esc(SEASON_LABEL[s])}</option>`).join('')}
      </select>
      <input class="form-control" type="date" name="since" value="${esc(since)}"
             max="${esc(today)}" title="The day they were put on">
      <button class="btn btn-ghost btn-sm" type="submit">Set</button>
    </form>`;
}

/**
 * One van: what is on it, and both sets side by side.
 *
 * Summer on the left and winter on the right, always in that order, on every
 * row -- a page you scan for a red tyre is a page where the same thing has to
 * be in the same place on every line.
 */
function vehicleRow(v, sets, past, today, ret) {
  /* The stripe down the side of the row is about THIS VAN, so it is the set
     that is on it: a van driving on 7 mm summer tyres is not a red van
     because a 2 mm winter set is sitting on a shelf. When nobody has said
     which set is fitted, both count -- that is the honest answer then. */
  const seasons = v.fitted_season ? [v.fitted_season] : SEASONS;
  const worst = wheels.worstOf(seasons.flatMap(season => {
    const set = sets.get(`${v.plate}|${season}`);
    return POSITIONS.map(p => {
      const l = set && latest(set, p);
      return l ? l.depth_mm : null;
    });
  }));
  const since = wheels.asDay(v.fitted_since);
  return `<div class="wrow band-${esc(worst)}" id="v-${esc(v.plate)}">
    <div class="wrow-head">
      <a class="wplate mono" href="#v-${esc(v.plate)}">${esc(v.plate)}</a>
      <span class="wnote">${esc(v.note || '')}</span>
      <span class="wfitted-now">${v.fitted_season
        ? `On <strong>${esc(SEASON_LABEL[v.fitted_season].toLowerCase())}</strong>${
            since ? ` since ${esc(since)}` : ''}`
        : '<span class="muted">which set is on it is not recorded</span>'}</span>
      ${fittedForm(v, today, ret)}
    </div>
    <div class="wseasons">${SEASONS.map(season =>
      seasonBlock(v.plate, season, sets.get(`${v.plate}|${season}`),
        past.get(`${v.plate}|${season}`) || [], v.fitted_season, today, ret)
    ).join('')}</div>
  </div>`;
}

/** The count per band across everything shown, worst first. */
function tallyLine(tally) {
  const parts = wheels.BANDS.map(b => tally[b.key]
    ? `<span class="wtally band-${b.key}">${esc(tally[b.key])} ${esc(b.label.toLowerCase())}</span>` : '')
    .filter(Boolean);
  if (tally.unknown) parts.push(`<span class="wtally band-unknown">${esc(tally.unknown)} not measured</span>`);
  /* Not a band -- it cuts across them. A tyre measured last winter is counted
     in whatever band that reading fell in AND here, because the number on it
     is no longer a description of the tyre. */
  if (tally.stale) {
    parts.push(`<span class="wtally wtally-stale"
      title="Last measured more than ${wheels.STALE_DAYS} days ago">${esc(tally.stale)} not measured lately</span>`);
  }
  return parts.join('') || '<span class="muted">nothing to show</span>';
}

function wheelsPage({ vehicles, sets, tally, filters, today, message, nav }) {
  const ret = '/admin/wheels' + (filters.query || '');
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  /* Live sets are what the tiles show; retired ones are the history under
     "Earlier sets". One pass, because the query hands them over together. */
  const byKey = new Map();
  const pastByKey = new Map();
  for (const s of sets) {
    const key = `${s.plate}|${s.season}`;
    if (s.retired_on) {
      if (!pastByKey.has(key)) pastByKey.set(key, []);
      pastByKey.get(key).push(s);
    } else {
      byKey.set(key, s);
    }
  }

  const rows = vehicles.map(v => vehicleRow(v, byKey, pastByKey, today, ret)).join('\n');

  const html = `  <div class="page-head">
    <h1>Wheels</h1>
    <div class="muted">Tyres on ${esc(vehicles.length)} ${vehicles.length === 1 ? 'van' : 'vans'} · summer and winter</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}

  <p class="lede">Every van, both sets, four numbers each. <strong>Click a tyre</strong> to write down
     what the gauge said – the depth shows on the tyre in its colour, and every reading is kept, so
     two of them tell you how fast it is wearing and roughly when it reaches 3 mm.
     Under <strong>0-3 mm change now</strong>, <strong>3-5 mm about two months left</strong>,
     <strong>5 mm and up fine</strong>, <strong>8 mm and up as new</strong>.
     <span class="muted">(The law says 1,6 mm on summer tyres and 3,0 mm on winter tyres in winter
     conditions – these bands are stricter on purpose.)</span></p>

  <form class="filters no-print" method="get" action="/admin/wheels">
    <div class="f"><label for="plate">Vehicle</label>
      <input class="form-control mono" id="plate" name="plate" type="text" maxlength="16" list="w-plates"
             value="${esc(filters.plate)}" placeholder="Any">
      <datalist id="w-plates">${vehicles.map(v => `<option value="${esc(v.plate)}"></option>`).join('')}</datalist></div>
    <div class="f"><label for="band">Tread</label>
      <select class="form-control" id="band" name="band">
        ${opt('', 'All', filters.band)}${wheels.BANDS.map(b => opt(b.key, b.label, filters.band)).join('')}${
          opt('unknown', 'Not measured', filters.band)}${opt('attention', 'Needs attention (under 5 mm)', filters.band)}${
          opt('stale', `Not measured in ${wheels.STALE_DAYS} days`, filters.band)}
      </select></div>
    <div class="f"><label for="fitted">On the van</label>
      <select class="form-control" id="fitted" name="fitted">
        ${opt('', 'All', filters.fitted)}${SEASONS.map(s => opt(s, SEASON_LABEL[s], filters.fitted)).join('')}${
          opt('none', 'Not recorded', filters.fitted)}
      </select></div>
    <button class="btn btn-primary" type="submit">Show</button>
    <a class="btn btn-ghost" href="/admin/wheels">Everything</a>
    <a class="btn btn-secondary" href="/admin/wheels.csv${esc(filters.query)}"
       title="Every tyre below, with its latest reading">Download CSV</a>
  </form>

  <div class="card">
    <div class="card-header">Tread across the fleet
      <span class="step-tag wtallies">${tallyLine(tally)}</span></div>
  </div>

${rows || '<p class="muted" style="padding:20px">No van matches. Widen the filter.</p>'}

  <div class="card">
    <div class="card-header">About the tread bands</div>
    <div class="card-body">
      <p><strong>One reading per axle.</strong> Front and back, per set – measured in the middle of
         the tread, on the shallowest groove you can find. If one side of an axle is visibly worse
         than the other, that is an alignment job and belongs in the note, not in a second number.</p>
      <p><strong>Every reading is kept.</strong> A new one never overwrites the last, which is what
         lets the page work out millimetres a month and say roughly when the tyre reaches 3 mm. Two
         readings less than three weeks apart are ignored for that: a gauge is good to about a tenth
         of a millimetre, and over a fortnight that is most of the wear, so the answer would be noise
         with a date on it. The × next to a reading is for a number typed wrong – not for a tyre
         that has been changed, which is a new set, not a deleted history.</p>
      <p><strong>0-3 mm</strong> is <em>change now</em>: under the winter minimum, and close enough to
         the summer one that it will be under it before anybody gets round to it. <strong>3-5 mm</strong>
         is <em>about two months</em> at the wear an ordinary delivery van sees – time to order, not
         time to panic. <strong>5 mm and up</strong> is fine, <strong>8 mm and up</strong> is a set that
         has barely been driven on.</p>
      <p><strong>A reading goes out of date.</strong> A tile says when it was measured, and marks
         itself <em>old</em> once that is more than ${esc(wheels.STALE_DAYS)} days back – 6 mm last
         March is not 6 mm now, and every colour on this page is built on the last reading. The
         tread filter has <em>Not measured in ${esc(wheels.STALE_DAYS)} days</em> for exactly the
         round anybody would do about it.</p>
      <p><strong>New tyres are a new set</strong>, not a reset. <em>New set</em> under a season puts
         the old one aside with the day it came off – it keeps its readings, its make and its DOT
         code under <em>Earlier sets</em> – and starts an empty one. Measuring new rubber into the
         old set's history would make every wear figure above it wrong.</p>
      <p><strong>Which set is on the van</strong> is set on each row. It is worth keeping straight:
         it is what tells you, in November, which vans are still on summer tyres – and the DOT code
         under a set is the week and year that rubber was made, which matters on a spare set that
         spends nine months of the year on a shelf.</p>
    </div>
  </div>`;

  return page({
    title: 'Wheels – admin', body: html, links: LINKS,
    bodyClass: 'wide', lang: 'en', admin: true
  });
}

module.exports = { wheelsPage, SEASON_LABEL, SEASONS, POSITION_LABEL, POSITIONS, TYPE_LABEL,
  TYRE_ART, latest };
