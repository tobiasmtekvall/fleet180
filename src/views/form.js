'use strict';

const { page, esc } = require('./layout');
const { CHOICES } = require('../fields');

/* Consecutive questions that name the same section share one card, which
   is how the original four-part page is reproduced without the section
   being a separate thing the admin has to manage. */
function groupBySection(fields) {
  const groups = [];
  for (const f of fields) {
    const last = groups[groups.length - 1];
    if (last && last.section === (f.section || '')) last.fields.push(f);
    else groups.push({ section: f.section || '', fields: [f] });
  }
  return groups;
}

function renderField(f) {
  const star = f.required ? '<span class="star">*</span>' : '';

  if (f.kind === 'info') {
    return `        <div class="field info-field"><p>${esc(f.label)}</p></div>`;
  }

  if (f.kind === 'photo') {
    return `        <div class="field" data-kind="photo">
          <label for="${esc(f.name)}">${esc(f.label)}</label>
          <div class="uploader">
            <button type="button" class="camera-btn" data-target="${esc(f.name)}">Öppna kamera</button>
            <input type="file" id="${esc(f.name)}" name="${esc(f.name)}" accept="image/*" capture="environment" multiple hidden>
            <div class="thumbs" id="thumbs-${esc(f.name)}"></div>
          </div>
        </div>`;
  }

  if (f.kind === 'yesno') {
    const choices = CHOICES.map(c => `
            <label class="choice">
              <input type="radio" name="${esc(f.name)}" value="${esc(c.value)}"${f.required ? ' data-required="1"' : ''}>
              <span>${esc(c.label)}</span>
            </label>`).join('');
    return `        <div class="field" data-kind="yesno" data-name="${esc(f.name)}">
          <label id="lbl-${esc(f.name)}">${esc(f.label)}${star}</label>
          <div class="choices" role="radiogroup" aria-labelledby="lbl-${esc(f.name)}">${choices}
          </div>
          <div class="comment" data-comment-for="${esc(f.name)}">
            <label for="${esc(f.name)}__comment">Kommentar</label>
            <input type="text" class="form-control optional" id="${esc(f.name)}__comment" name="${esc(f.name)}__comment" placeholder="Beskriv vad som är fel">
          </div>
          <div class="err"></div>
        </div>`;
  }

  // text
  const cls = f.required ? 'form-control' : 'form-control optional';
  const attrs = [f.required ? 'required' : '', f.role === 'driver' ? 'autocomplete="name"' : '']
    .filter(Boolean).join(' ');
  return `        <div class="field" data-kind="text" data-name="${esc(f.name)}">
          <label for="${esc(f.name)}">${esc(f.label)}${star}</label>
          <input type="text" class="${cls}" id="${esc(f.name)}" name="${esc(f.name)}" ${attrs}>
          <div class="err"></div>
        </div>`;
}

function actions() {
  return `
        <div class="actions">
          <button type="button" class="btn btn-ghost" id="clearBtn">Rensa</button>
          <button type="button" class="btn btn-secondary" id="printBtn">Skriv ut / PDF</button>
          <button type="submit" class="btn btn-primary" id="submitBtn">Bekräfta och skicka</button>
        </div>`;
}

function rail(groups) {
  const named = groups.filter(g => g.section);
  if (named.length < 2) return '';
  return `<nav class="rail">
${named.map((g, i) =>
  `    <a href="#sec${i + 1}"><span class="num">${i + 1}</span><span class="t">${esc(g.section)}</span></a>`
).join('\n')}
  </nav>`;
}

function formPage({ vehicle, form, lastCheck, preview = false }) {
  const groups = groupBySection(form.fields);

  const cards = groups.map((g, i) => `    <section class="card" id="sec${i + 1}">
      <div class="card-header">
        ${esc(form.title)}
        ${g.section ? `<span class="step-tag">${esc(g.section)}</span>` : ''}
      </div>
      <div class="card-body">
${g.fields.map(renderField).join('\n')}
${i === groups.length - 1 ? actions() : ''}
      </div>
    </section>`).join('\n');

  const last = preview
    ? `<div class="warn no-print">Förhandsgranskning – inget går att skicka in härifrån.
        <a href="/admin/forms/${esc(form.id)}">Tillbaka till redigeringen</a>.</div>`
    : lastCheck
      ? `<p class="lede">Senaste kontroll: ${esc(lastCheck)}</p>`
      : `<p class="lede">Ingen kontroll registrerad för detta fordon ännu.</p>`;

  const empty = form.fields.length
    ? ''
    : `<div class="warn">Det här formuläret har inga frågor ännu. Lägg till dem under
        <a href="/admin/forms">Admin → Formulär</a>.</div>`;

  const body = `  <div class="page-head">
    <h1>${esc(form.title)}</h1>
    <div class="plate" id="plate">${esc(vehicle.plate)}</div>
  </div>
  ${last}

${rail(groups)}

  <div class="notice" id="notice"></div>
  ${empty}

  <form id="${preview ? 'previewForm' : 'checkForm'}" method="post" action="/v/${esc(vehicle.plate)}" enctype="multipart/form-data" novalidate>
${cards}
  </form>`;

  return page({
    title: `${vehicle.plate} – ${form.title}`,
    body,
    links: [{ href: '/', text: 'Alla fordon' }],
    scripts: '<script src="/form.js"></script>'
  });
}

module.exports = { formPage };
