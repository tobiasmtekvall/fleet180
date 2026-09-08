'use strict';

const { page, esc } = require('./layout');
const { CHOICES, optionsFor } = require('../fields');
const i18n = require('../i18n');

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

function renderField(f, lang, sources) {
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
    const options = [`<option value="" ${uiAttrs('choose')}>${esc(i18n.t(lang, 'choose'))}</option>`]
      .concat(opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`)).join('\n            ');
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
        </div>`;
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
    return `        <div class="field" data-kind="yesno" data-name="${esc(f.name)}">
          <label id="lbl-${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}${star}</label>
          <div class="choices" role="radiogroup" aria-labelledby="lbl-${esc(f.name)}">${choices}
          </div>
          <div class="comment" data-comment-for="${esc(f.name)}">
            <label for="${esc(f.name)}__comment" ${uiAttrs('comment')}>${esc(i18n.t(lang, 'comment'))}</label>
            <input type="text" class="form-control optional" id="${esc(f.name)}__comment"
                   name="${esc(f.name)}__comment" ${uiAttrs('commentPlaceholder')}
                   placeholder="${esc(i18n.t(lang, 'commentPlaceholder'))}">
          </div>
          <div class="err"></div>
        </div>`;
  }

  const cls = f.required ? 'form-control' : 'form-control optional';
  const attrs = [f.required ? 'required' : '', f.role === 'driver' ? 'autocomplete="name"' : '']
    .filter(Boolean).join(' ');
  return `        <div class="field" data-kind="text" data-name="${esc(f.name)}">
          <label for="${esc(f.name)}" ${labelAttrs}>${esc(labels[lang])}${star}</label>
          <input type="text" class="${cls}" id="${esc(f.name)}" name="${esc(f.name)}" ${attrs}>
          <div class="err"></div>
        </div>`;
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

/** The flag row. Tiny by design -- it sits above the form, not in it. */
function flags(lang) {
  return `<div class="flags no-print" role="group" aria-label="${esc(i18n.t(lang, 'languageLabel'))}">
${i18n.LANGS.map(l =>
  `    <button type="button" class="flag${l.code === lang ? ' on' : ''}" data-lang="${l.code}"
            title="${esc(l.label)}" aria-label="${esc(l.label)}">${l.flag}</button>`).join('\n')}
  </div>`;
}

function formPage({ vehicle, form, lastCheck, preview = false, lang = 'sv', sources = {} }) {
  const code = i18n.langOf(lang);
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
${g.fields.map(f => renderField(f, code, sources)).join('\n')}
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
  ${flags(code)}
  ${last}

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
    scripts: `<script>window.FLEET180_UI=${JSON.stringify(i18n.UI)};window.FLEET180_LANGS=${JSON.stringify(i18n.LANGS)};</script>
<script src="/form.js"></script>`
  });
}

module.exports = { formPage };
