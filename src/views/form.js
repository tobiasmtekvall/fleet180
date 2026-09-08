'use strict';

const { page, esc } = require('./layout');
const { FORM_TITLE, SECTIONS } = require('../form-def');

function renderField(f) {
  if (f.kind === 'file') {
    return `<div class="field">
          <label for="${f.name}">${esc(f.label)}</label>
          <div class="uploader">
            <button type="button" class="camera-btn" data-target="${f.name}">Öppna kamera</button>
            <input type="file" id="${f.name}" name="${f.name}" accept="image/*" capture="environment" multiple hidden>
            <div class="thumbs" id="thumbs-${f.name}"></div>
          </div>
        </div>`;
  }
  const star = f.required ? '<span class="star">*</span>' : '';
  const cls = f.required ? 'form-control' : 'form-control optional';
  const extra = [
    f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : '',
    f.inputmode ? `inputmode="${esc(f.inputmode)}"` : '',
    f.required ? 'required' : ''
  ].filter(Boolean).join(' ');
  const err = f.required ? '<div class="err">Fältet är obligatoriskt.</div>' : '';
  return `<div class="field">
          <label for="${f.name}">${esc(f.label)}${star}</label>
          <input type="text" class="${cls}" id="${f.name}" name="${f.name}" ${extra}>
          ${err}
        </div>`;
}

function renderSection(s) {
  return `    <section class="card" id="${s.id}">
      <div class="card-header">
        ${esc(FORM_TITLE)}
        <span class="step-tag">${esc(s.tag)}</span>
      </div>
      <div class="card-body">
${s.fields.map(renderField).join('\n')}
${s.id === 'sec4' ? actions() : ''}
      </div>
    </section>`;
}

function actions() {
  return `
        <div class="actions">
          <button type="button" class="btn btn-ghost" id="clearBtn">Rensa</button>
          <button type="button" class="btn btn-secondary" id="printBtn">Skriv ut / PDF</button>
          <button type="submit" class="btn btn-primary" id="submitBtn">Bekräfta och skicka</button>
        </div>`;
}

function rail() {
  return `<nav class="rail">
${SECTIONS.map(s =>
  `    <a href="#${s.id}"><span class="num">${s.num}</span><span class="t">${esc(s.rail)}</span></a>`
).join('\n')}
  </nav>`;
}

function formPage({ vehicle, lastCheck }) {
  const last = lastCheck
    ? `<p class="lede">Senaste kontroll: ${esc(lastCheck)}</p>`
    : `<p class="lede">Ingen kontroll registrerad för detta fordon ännu.</p>`;

  const body = `  <div class="page-head">
    <h1>${esc(FORM_TITLE)}</h1>
    <div class="plate" id="plate">${esc(vehicle.plate)}</div>
  </div>
  ${last}

${rail()}

  <div class="notice" id="notice"></div>

  <form id="checkForm" method="post" action="/v/${esc(vehicle.plate)}" enctype="multipart/form-data" novalidate>
${SECTIONS.map(renderSection).join('\n')}
  </form>`;

  return page({
    title: `${vehicle.plate} – ${FORM_TITLE}`,
    body,
    links: [{ href: '/', text: 'Alla fordon' }],
    scripts: '<script src="/form.js"></script>'
  });
}

module.exports = { formPage };
