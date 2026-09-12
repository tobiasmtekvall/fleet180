'use strict';

const { page, esc } = require('./layout');
const { CHOICES, optionsFor, commentChoices, commentOptionsFor } = require('../fields');
const i18n = require('../i18n');
const { sameName } = require('../assignment');
const { flagSvg } = require('./flags');
const odo = require('../odometer');

/* Consecutive questions that name the same section share one card, which
   is how the original four-part page is reproduced without the section
   being a separate thing the admin has to manage. */
function groupBySection(fields) {
  const groups = [];
  for (const f of fields) {
    const last = groups[groups.length - 1];
    if (last && last.sv === (f.section || '')) last.fields.push(f);
    else groups.push({ sv: f.section || '', fields: [f] });
  }
  return groups;
}

/**
 * Every language's wording is written into the page as data-t-* attributes.
 * Switching flags then swaps text in place instead of reloading, which is
 * why a half-filled form survives a language change -- nothing is re-fetched
 * and no input is ever recreated.
 */
function langAttrs(texts, prefix = 't') {
  return i18n.CODES.map(c => `data-${prefix}-${c}="${esc(texts[c] || '')}"`).join(' ');
}

function uiAttrs(key) {
  const texts = {};
  for (const c of i18n.CODES) texts[c] = i18n.t(c, key);
  return langAttrs(texts);
}

/** Every language's wording for one sentence, with {placeholders} filled. */
function filledAttrs(key, vars) {
  const texts = {};
  for (const c of i18n.CODES) texts[c] = i18n.fill(i18n.t(c, key), vars);
  return langAttrs(texts);
}
function filledText(lang, key, vars) {
  return i18n.fill(i18n.t(lang, key), vars);
}

function renderField(f, lang, sources, ctx = {}) {
  const labels = i18n.allFieldText(f, 'label');
  const star = f.required ? '<span class="star">*</span>' : '';
  const labelAttrs = langAttrs(labels);

  if (f.kind === 'info') {
    return `        <div class="field info-field">
          <p ${labelAttrs}>${esc(labels[lang])}</p>
        </div>`;
  }

  if (f.kind === 'photo') {
    return `        <div class="field" data-kind="photo">
          <label for="${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}</label>
          <div class="uploader">
            <button type="button" class="camera-btn" data-target="${esc(f.name)}" ${uiAttrs('openCamera')}>${esc(i18n.t(lang, 'openCamera'))}</button>
            <input type="file" id="${esc(f.name)}" name="${esc(f.name)}" accept="image/*" capture="environment" multiple hidden>
            <div class="thumbs" id="thumbs-${esc(f.name)}"></div>
          </div>
        </div>`;
  }

  if (f.kind === 'select') {
    const opts = optionsFor(f, sources);
    const cls = f.required ? 'form-control' : 'form-control optional';
    // The scanned vehicle's driver (and route) for today, pre-selected. Only
    // an exact option is ever selected: a dropdown may carry nothing but its
    // own values, and a near-miss would be refused at submit with a message
    // about a list the driver never touched.
    const pre = prefillFor(f, ctx);
    const options = [`<option value="" ${uiAttrs('choose')}>${esc(i18n.t(lang, 'choose'))}</option>`]
      .concat(opts.map(o =>
        `<option value="${esc(o)}"${pre && sameName(o, pre) ? ' selected' : ''}>${esc(o)}</option>`))
      .join('\n            ');
    const emptyNote = opts.length ? '' :
      `<div class="err show">Listan är tom – ${f.source === 'drivers'
        ? 'inga förare har synkats ännu.' : 'lägg till alternativ i formulärredigeraren.'}</div>`;
    return `        <div class="field" data-kind="select" data-name="${esc(f.name)}">
          <label for="${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}${star}</label>
          <select class="${cls}" id="${esc(f.name)}" name="${esc(f.name)}"${f.required ? ' required' : ''}>
            ${options}
          </select>
          ${emptyNote}
          <div class="err"></div>
        </div>${changeBox(f, lang, ctx)}`;
  }

  if (f.kind === 'yesno') {
    const choices = CHOICES.map(c => {
      const texts = {};
      for (const code of i18n.CODES) {
        texts[code] = i18n.t(code, c.value === 'ja' ? 'yes' : c.value === 'nej' ? 'no' : 'other');
      }
      return `
            <label class="choice">
              <input type="radio" name="${esc(f.name)}" value="${esc(c.value)}"${f.required ? ' data-required="1"' : ''}>
              <span ${langAttrs(texts)}>${esc(texts[lang])}</span>
            </label>`;
    }).join('');
    // The choices that open the comment box travel with the field, because
    // they are per question -- see commentChoices().
    const opens = [...commentChoices(f)].join(' ');
    /* "Which lamp?" -- a list offered with the comment box when the answer
       flags. Every language's wording rides on each <option> so the flags
       switch the list in place like everything else, while the value posted
       stays the Swedish one. */
    const picks = commentOptionsFor(f);
    const pickI18n = (f.i18n || {});
    const pickBox = picks.length ? `
          <div class="comment-pick">
            <label for="${esc(f.name)}__pick" ${uiAttrs('pickLabel')}>${esc(i18n.t(lang, 'pickLabel'))}<span class="star">*</span></label>
            <select class="form-control" id="${esc(f.name)}__pick" name="${esc(f.name)}__pick">
              <option value="" ${uiAttrs('choose')}>${esc(i18n.t(lang, 'choose'))}</option>
${picks.map((o, i) => {
  const texts = {};
  for (const c of i18n.CODES) {
    const list = c === i18n.DEFAULT_LANG ? picks
      : ((pickI18n[c] && pickI18n[c].commentOptions) || []);
    texts[c] = (list && list[i]) || o;
  }
  return `              <option value="${esc(o)}" ${langAttrs(texts)}>${esc(texts[lang] || o)}</option>`;
}).join('\n')}
            </select>
          </div>` : '';
    return `        <div class="field" data-kind="yesno" data-name="${esc(f.name)}" data-comment-on="${esc(opens)}">
          <label id="lbl-${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}${star}</label>
          <div class="choices" role="radiogroup" aria-labelledby="lbl-${esc(f.name)}">${choices}
          </div>
          <div class="comment" data-comment-for="${esc(f.name)}">${pickBox}
            <label for="${esc(f.name)}__comment" ${uiAttrs('comment')}>${esc(i18n.t(lang, 'comment'))}</label>
            <input type="text" class="form-control optional" id="${esc(f.name)}__comment"
                   name="${esc(f.name)}__comment" ${uiAttrs('commentPlaceholder')}
                   placeholder="${esc(i18n.t(lang, 'commentPlaceholder'))}">
          </div>
          <div class="err"></div>
        </div>`;
  }

  const cls = f.required ? 'form-control' : 'form-control optional';
  const pre = prefillFor(f, ctx);
  const meter = f.role === 'odometer' ? odometerBits(lang, ctx) : null;
  const attrs = [f.required ? 'required' : '', f.role === 'driver' ? 'autocomplete="name"' : '',
    meter ? 'inputmode="numeric" autocomplete="off" data-odo="1"' : '',
    meter && meter.prefix ? `data-odo-prefix="${esc(meter.prefix)}"` : '',
    meter && meter.last ? `data-odo-last="${esc(meter.last)}"` : '',
    (meter && meter.prefix) ? `value="${esc(meter.prefix)}"` : (pre ? `value="${esc(pre)}"` : '')]
    .filter(Boolean).join(' ');
  return `        <div class="field" data-kind="text" data-name="${esc(f.name)}">
          <label for="${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}${star}</label>
          <input type="text" class="${cls}" id="${esc(f.name)}" name="${esc(f.name)}" ${attrs}>
          ${meter ? meter.hint : ''}
          <div class="err"></div>
        </div>${changeBox(f, lang, ctx)}`;
}

/**
 * What the odometer question knows about this vehicle.
 *
 * The field opens holding everything but the last three digits of the previous
 * reading, so the driver types three rather than six -- and two rather than
 * one when the reading is about to pass the next thousand (see odometer.js).
 * The previous reading is printed underneath in full, because a prefix nobody
 * can check is a prefix nobody should trust.
 */
function odometerBits(lang, ctx) {
  const prev = ctx && ctx.odometer;
  if (!prev || !prev.odometer) return null;
  const { prefix, blanks, last } = odo.prefill(prev.odometer);
  if (!prefix) return null;
  const when = String(prev.date || '').slice(0, 10);
  const vars = { value: odo.group(last), date: when };
  const hint = `<p class="odo-hint">
            <span ${filledAttrs('odometerLast', vars)}>${esc(filledText(lang, 'odometerLast', vars))}</span>
            <span ${uiAttrs('odometerFill')}>${esc(i18n.t(lang, 'odometerFill'))}</span>
          </p>`;
  return { prefix, blanks, last, hint };
}

/**
 * What today's assignment fills into this question, if anything.
 *
 * Only with exactly one assigned driver: two names and there is nothing to
 * fill in -- see todaysAssignment(). The route travels with the driver,
 * because it is that driver's route, not the vehicle's.
 */
function prefillFor(f, ctx) {
  const one = ctx && ctx.assignment && ctx.assignment.one;
  if (!one || ctx.preview) return '';
  if (f.role === 'driver') return one.driver || '';
  if (f.role === 'route') return one.route || '';
  return '';
}

/**
 * The question that has to be answered when the person filling in the check
 * is not the person the vehicle was given to.
 *
 * It sits immediately under the driver's name -- the answer that raises it --
 * rather than at the end of the form, because a driver who has already
 * answered twenty questions is not reading the twenty-first. Hidden until the
 * name differs, and enforced again on the server: this is a rule about who is
 * driving, not a hint, and the page it is drawn on is the driver's own phone.
 */
function changeBox(f, lang, ctx) {
  if (!ctx || f.role !== 'driver' || ctx.preview) return '';
  // Only the first question that claims the driver role gets it; two of them
  // is a misconfiguration, and two boxes watching one answer is worse than one.
  if (ctx.driverBoxDrawn) return '';
  ctx.driverBoxDrawn = true;

  /* Drawn even when nothing is assigned yet. The assignment is pushed from the
     assigner during the morning, and a driver who scanned the QR code at 06:40
     and submits at 07:10 would otherwise be refused by the server for not
     answering a question their page never contained -- with twenty answers and
     four photos in it, and a reload the only way out. The question's wording is
     filled in by the page when that happens (form.js). */
  const list = (ctx.assignment && ctx.assignment.list) || [];
  const one = ctx.assignment && ctx.assignment.one;
  const assigned = one ? one.driver : list.map(a => a.driver).join(', ');
  const route = one ? (one.route || '') : '';
  const vars = { assigned, plate: ctx.plate, route };
  const key = route ? 'changeQuestionRoute' : 'changeQuestion';
  const yes = {}, no = {};
  for (const c of i18n.CODES) { yes[c] = i18n.t(c, 'yes'); no[c] = i18n.t(c, 'no'); }
  const question = list.length
    ? `<p class="change-q" id="changeQ" ${filledAttrs(key, vars)}>${esc(filledText(lang, key, vars))}</p>`
    : `<p class="change-q" id="changeQ"></p>`;

  return `
        <div class="field change-box" id="changeBox" data-kind="change" hidden
             data-for="${esc(f.name)}"
             data-assigned="${esc(list.map(a => a.driver).join('|'))}">
          <div class="change-head" ${uiAttrs('changeTitle')}>${esc(i18n.t(lang, 'changeTitle'))}</div>
          ${question}
          <div class="choices" role="radiogroup" aria-labelledby="changeQ">
            <label class="choice">
              <input type="radio" name="__driver_change" value="ja">
              <span ${langAttrs(yes)}>${esc(yes[lang])}</span>
            </label>
            <label class="choice">
              <input type="radio" name="__driver_change" value="nej">
              <span ${langAttrs(no)}>${esc(no[lang])}</span>
            </label>
          </div>
          <div class="change-approver">
            <label for="__change_approver" ${uiAttrs('changeApprover')}>${esc(i18n.t(lang, 'changeApprover'))}<span class="star">*</span></label>
            <input type="text" class="form-control" id="__change_approver" name="__change_approver"
                   autocomplete="off" ${uiAttrs('changeApproverPlaceholder')}
                   placeholder="${esc(i18n.t(lang, 'changeApproverPlaceholder'))}">
          </div>
          <div class="err"></div>
        </div>`;
}

/** "X is assigned to this van today" -- the line above the form. */
function assignedBanner(lang, ctx) {
  const list = (ctx.assignment && ctx.assignment.list) || [];
  if (!list.length) return '';
  const one = ctx.assignment.one;
  const lineKey = one && one.route ? 'assignedLineRoute' : 'assignedLine';
  const vars = one ? { driver: one.driver, plate: ctx.plate, route: one.route || '' } : {};
  const line = one
    ? `<p class="assign-line" ${filledAttrs(lineKey, vars)}>${esc(filledText(lang, lineKey, vars))}</p>`
    : `<p class="assign-line">${esc(list.map(a => a.route ? `${a.driver} (${a.route})` : a.driver).join(' · '))}</p>`;
  const hint = one ? 'assignedPrefilled' : 'assignedSeveral';
  return `<div class="assign-box">
    <span class="assign-tag" ${uiAttrs('assignedToday')}>${esc(i18n.t(lang, 'assignedToday'))}</span>
    ${line}
    <p class="assign-hint" ${uiAttrs(hint)}>${esc(i18n.t(lang, hint))}</p>
  </div>`;
}

/**
 * "Drivers of this car last week", top of the page.
 *
 * One line per day: who the van was given to, and who actually signed for it
 * when that is somebody else. A <details> so it takes one line on a phone
 * until it is wanted, open on first sight because it is the kind of thing a
 * driver checks before asking anyone.
 */
function weekPanel(lang, ctx) {
  const week = ctx.week;
  if (!week) return '';
  const rows = (week.days || []).map(d => {
    const assigned = d.assigned.map(a => a.route ? `${a.driver} (${a.route})` : a.driver).join(', ');
    const checks = d.checks.map(c =>
      `${esc(c.driver || '—')}${c.swapped ? ` <span class="swapped" ${uiAttrs('weekSwapped')}>${esc(i18n.t(lang, 'weekSwapped'))}</span>` : ''}`).join(' · ');
    const isToday = d.date === week.to;
    return `      <li>
        <span class="wd">${esc(d.date)}${isToday ? ` <em ${uiAttrs('weekToday')}>${esc(i18n.t(lang, 'weekToday'))}</em>` : ''}</span>
        <span class="wa">${assigned
          ? `<b ${uiAttrs('weekAssigned')}>${esc(i18n.t(lang, 'weekAssigned'))}</b> ${esc(assigned)}` : ''}</span>
        <span class="wc">${checks
          ? `<b ${uiAttrs('weekChecked')}>${esc(i18n.t(lang, 'weekChecked'))}</b> ${checks}` : ''}</span>
      </li>`;
  }).join('\n');

  const body = rows
    ? `    <ul class="week-list">\n${rows}\n    </ul>`
    : `    <p class="week-none" ${uiAttrs('weekNone')}>${esc(i18n.t(lang, 'weekNone'))}</p>`;

  return `<details class="week-box no-print" open>
    <summary ${uiAttrs('weekTitle')}>${esc(i18n.t(lang, 'weekTitle'))}</summary>
${body}
  </details>`;
}

function actions(lang) {
  return `
        <div class="actions">
          <button type="button" class="btn btn-ghost" id="clearBtn" ${uiAttrs('clear')}>${esc(i18n.t(lang, 'clear'))}</button>
          <button type="button" class="btn btn-secondary" id="printBtn" ${uiAttrs('print')}>${esc(i18n.t(lang, 'print'))}</button>
          <button type="submit" class="btn btn-primary" id="submitBtn" ${uiAttrs('submit')}>${esc(i18n.t(lang, 'submit'))}</button>
        </div>`;
}

function rail(groups, lang) {
  const named = groups.filter(g => g.sv);
  if (named.length < 2) return '';
  return `<nav class="rail">
${named.map((g, i) => {
  const texts = i18n.allFieldText({ section: g.sv, i18n: g.fields[0].i18n }, 'section');
  return `    <a href="#sec${i + 1}"><span class="num">${i + 1}</span><span class="t" ${langAttrs(texts)}>${esc(texts[lang])}</span></a>`;
}).join('\n')}
  </nav>`;
}

/**
 * The flag row. Tiny by design -- it sits above the form, not in it.
 *
 * Drawn flags rather than emoji (see views/flags.js), each with the language's
 * own name beside it: a driver looking for Arabic finds العربية faster than
 * they find a green rectangle.
 */
function flags(lang) {
  return `<div class="flags no-print" role="group" aria-label="${esc(i18n.t(lang, 'languageLabel'))}">
${i18n.LANGS.map(l =>
  `    <button type="button" class="flag${l.code === lang ? ' on' : ''}" data-lang="${l.code}"
            title="${esc(l.label)}" aria-label="${esc(l.label)}" lang="${l.code}">
      <span class="flag-img">${flagSvg(l.code)}</span>
      <span class="flag-name">${esc(l.label)}</span>
    </button>`).join('\n')}
  </div>`;
}

function formPage({ vehicle, form, lastCheck, preview = false, lang = 'sv', sources = {},
                    assignment = null, week = null, odometer = null }) {
  const code = i18n.langOf(lang);
  const ctx = { assignment, week, odometer: preview ? null : odometer,
                plate: vehicle.plate, preview, driverBoxDrawn: false };
  const groups = groupBySection(form.fields);
  const titles = {};
  for (const c of i18n.CODES) titles[c] = i18n.formTitle(form, c);

  const cards = groups.map((g, i) => {
    const sectionTexts = i18n.allFieldText({ section: g.sv, i18n: g.fields[0].i18n }, 'section');
    return `    <section class="card" id="sec${i + 1}">
      <div class="card-header">
        <span ${langAttrs(titles)}>${esc(titles[code])}</span>
        ${g.sv ? `<span class="step-tag" ${langAttrs(sectionTexts)}>${esc(sectionTexts[code])}</span>` : ''}
      </div>
      <div class="card-body">
${g.fields.map(f => renderField(f, code, sources, ctx)).join('\n')}
${i === groups.length - 1 ? actions(code) : ''}
      </div>
    </section>`;
  }).join('\n');

  const lastTexts = {};
  for (const c of i18n.CODES) {
    lastTexts[c] = lastCheck ? `${i18n.t(c, 'lastCheck')} ${lastCheck}` : i18n.t(c, 'noCheck');
  }

  const last = preview
    ? `<div class="warn no-print">Förhandsgranskning – inget går att skicka in härifrån.
        <a href="/admin/forms/${esc(form.id)}">Tillbaka till redigeringen</a>.</div>`
    : `<p class="lede" ${langAttrs(lastTexts)}>${esc(lastTexts[code])}</p>`;

  const empty = form.fields.length ? ''
    : `<div class="warn">Det här formuläret har inga frågor ännu. Lägg till dem under
        <a href="/admin/forms">Admin → Formulär</a>.</div>`;

  const body = `  <div class="page-head">
    <h1 ${langAttrs(titles)}>${esc(titles[code])}</h1>
    <div class="plate" id="plate">${esc(vehicle.plate)}</div>
  </div>
  ${preview ? '' : weekPanel(code, ctx)}
  ${flags(code)}
  ${last}
  ${preview ? '' : assignedBanner(code, ctx)}

${rail(groups, code)}

  <div class="notice" id="notice"></div>
  ${empty}

  <form id="${preview ? 'previewForm' : 'checkForm'}" method="post" action="/v/${esc(vehicle.plate)}" enctype="multipart/form-data" novalidate>
    <input type="hidden" name="__lang" id="langField" value="${esc(code)}">
${cards}
  </form>`;

  return page({
    title: `${vehicle.plate} – ${titles[code]}`,
    body,
    // No navigation: a driver reached this page from a QR code on one
    // vehicle and should see that vehicle's form and nothing else.
    links: preview ? [{ href: '/admin/forms', text: 'Formulär' }] : [],
    lang: code,
    // FLEET180_ASSIGNED is what the page needs to raise the driver-change
    // question by itself if the assignment lands after the page did.
    scripts: `<style>.no-js-show{display:none}</style>
<noscript><style>#changeBox[hidden]{display:block!important}</style></noscript>
<script>window.FLEET180_UI=${JSON.stringify(i18n.UI)};window.FLEET180_LANGS=${JSON.stringify(i18n.LANGS)};</script>
<script src="/form.js"></script>`
  });
}

module.exports = { formPage };
