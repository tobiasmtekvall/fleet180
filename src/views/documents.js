'use strict';
/**
 * Documents -- the filing cabinet under Expenses.
 *
 * Everywhere else in this app a file hangs off a thing: a photo belongs to a
 * check, an invoice belongs to a line in the ledger, an agreement belongs to
 * a hire. That is right for those files and wrong for the rest of them. A
 * leasing contract, an insurance policy, a scanned manual, the yard's fire
 * certificate -- none of those is an expense, and filing them as one would be
 * a lie that the totals would then have to be taught to ignore.
 *
 * So this tab holds papers instead of money, and it is organised the way an
 * office actually organises papers: in folders somebody made up and named
 * themselves. A file may also carry a registration number, and then it is a
 * van's paper as well as the folder's -- typing the plate into the box above
 * the list pulls up everything that belongs to that van, wherever it is
 * filed. That link is optional on purpose: most of these papers belong to the
 * company, not to one vehicle, and being made to pick a van for the insurance
 * policy would be the same lie in a smaller font.
 */

const { page, esc, fmtDateTime } = require('./layout');
const { sectionTabs, LINKS } = require('./incidents');

/** A sheet of paper. Deliberately plainer than the ledger's own icons. */
const DOC_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M6 3.5h8l4 4v13H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M14 3.5v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M9 12.5h6M9 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const FOLDER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M3.5 6.5h6l2 2.5h9v11h-17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

/** 812 -> "812 B", 20480 -> "20 kB". Big enough is all anybody reads here. */
function size(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} kB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** What to call a file in the list: what it was named, unless a title says better. */
function nameOf(d) {
  return d.title || d.filename || '(untitled)';
}

const field = (label, control, cls = '') =>
  `<label class="nf-field${cls ? ' ' + cls : ''}"><span>${label}</span>${control}</label>`;

function folderSelect(folders, current, name = 'folder') {
  return `<select class="form-control" name="${esc(name)}">
    <option value=""${!current ? ' selected' : ''}>Unfiled</option>
    ${folders.map(f => `<option value="${esc(f.id)}"${String(current) === String(f.id)
      ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
  </select>`;
}

/**
 * The vehicle box.
 *
 * A datalist and not a dropdown: the list is the fleet, but a paper may name a
 * van that has since left it, and a picker that cannot say the word on the
 * document is a picker that gets worked around in the title instead.
 */
function plateBox(plates, current, id) {
  return `<input class="form-control mono" type="text" name="plate" maxlength="16"
      list="${esc(id)}" value="${esc(current || '')}" placeholder="None"
      title="Optional. A registration number files this paper under that van as well.">
    <datalist id="${esc(id)}">${plates.map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>`;
}

/* ------------------------------------------------------------------ */
/* The folder rail                                                     */
/* ------------------------------------------------------------------ */

function folderRail(folders, counts, sel, qs) {
  const link = (key, label, n, extra = '') =>
    `<a href="/admin/documents${qs({ folder: key })}"${sel === key ? ' class="on"' : ''}${extra}>
      <span>${esc(label)}</span><em>${esc(n)}</em></a>`;

  return `<div class="card doc-rail">
    <div class="card-header">Folders</div>
    <div class="doc-rail-list">
      ${link('', 'All documents', counts.n)}
      ${link('none', 'Unfiled', counts.unfiled, ' title="Files that are in no folder yet"')}
      ${folders.length ? folders.map(f => link(String(f.id), f.name, f.n)).join('') : ''}
    </div>
    ${folders.length ? '' : `<p class="muted" style="padding:0 14px 6px">No folders yet.
       Everything you upload lands in <em>Unfiled</em> until you make one.</p>`}
    <details class="doc-newfolder">
      <summary>New folder</summary>
      <form method="post" action="/admin/documents/folder">
        <input type="hidden" name="ret" value="${esc(qs({}, true))}">
        <input class="form-control" type="text" name="name" maxlength="80" required
               placeholder="Insurance, Leasing, Manuals…">
        <input class="form-control" type="text" name="note" maxlength="200"
               placeholder="What goes in it (optional)">
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
    </details>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

function readRow(d, editHref, ret) {
  return `<div class="doc-row" id="doc-${esc(d.id)}">
    <div class="doc-name">
      <a href="/admin/documents/file/${esc(d.id)}" title="${esc(d.filename || '')}">${
        DOC_ICON}<span>${esc(nameOf(d))}</span></a>
      ${d.title && d.filename && d.title !== d.filename
        ? `<em class="doc-file">${esc(d.filename)}</em>` : ''}
    </div>
    <div class="doc-folder">${d.folder_id
      ? `${FOLDER_ICON} ${esc(d.folder_name)}` : '<em class="muted">Unfiled</em>'}</div>
    <div class="doc-plate mono">${d.plate ? esc(d.plate) : '<em class="muted">—</em>'}</div>
    <div class="doc-size">${esc(size(d.byte_size))}</div>
    <div class="doc-when">${esc(fmtDateTime(d.uploaded_at))}</div>
    <div class="doc-note">${d.note ? esc(d.note) : ''}</div>
    <div class="doc-actions no-print">
      <a class="btn btn-ghost btn-sm" href="${esc(editHref)}">Edit</a>
      <form method="post" action="/admin/documents/${esc(d.id)}/delete" style="display:inline">
        <!-- Back to the list, not to this row opened for editing: the row is
             about to stop existing, and Cancel should land where Delete was
             pressed from. -->
        <input type="hidden" name="ret" value="${esc(ret)}">
        <button class="btn btn-ghost btn-sm btn-danger-ghost" type="submit"
                title="Delete this file">Delete</button>
      </form>
    </div>
  </div>`;
}

/**
 * One file opened for editing.
 *
 * Moving a file between folders IS this form: there is one folder box and
 * changing it is the move. A drag-and-drop tray would look better and would
 * be one more thing that cannot be done from a phone in a yard, which is
 * where half of these uploads come from.
 */
function editRow(d, folders, plates, ret, closeHref) {
  return `<div class="doc-editing" id="doc-${esc(d.id)}">
    <div class="inc-editing-tag">Editing this file
      <a href="${esc(closeHref)}">close</a></div>
    <form class="nf" method="post" action="/admin/documents/${esc(d.id)}">
      <input type="hidden" name="ret" value="${esc(ret)}">
      <div class="nf-grid">
        ${field('Name', `<input class="form-control" type="text" name="title" maxlength="200"
            value="${esc(d.title || '')}" placeholder="${esc(d.filename || '')}"
            title="What this paper is called in the list. Empty means the file's own name.">`)}
        ${field('Folder', folderSelect(folders, d.folder_id, 'folder'))}
        ${field('Vehicle', plateBox(plates, d.plate, `doc-plates-${esc(d.id)}`))}
        ${field('Note', `<textarea class="form-control" name="note" rows="2" maxlength="2000"
            placeholder="Anything worth keeping beside it">${esc(d.note || '')}</textarea>`, 'nf-half')}
      </div>
      <div class="actions" style="justify-content:flex-start;margin-top:12px">
        <button class="btn btn-primary" type="submit">Save</button>
        <a class="btn btn-ghost" href="${esc(closeHref)}">Cancel</a>
        <span class="muted">${esc(d.filename || 'file')} · ${esc(size(d.byte_size))} ·
          uploaded ${esc(fmtDateTime(d.uploaded_at))} ·
          <a href="/admin/documents/file/${esc(d.id)}">open</a></span>
      </div>
    </form>
  </div>`;
}

function listHead() {
  return `<div class="doc-row doc-head">
    <div class="doc-name">Document</div>
    <div class="doc-folder">Folder</div>
    <div class="doc-plate">Vehicle</div>
    <div class="doc-size">Size</div>
    <div class="doc-when">Uploaded</div>
    <div class="doc-note">Note</div>
    <div class="doc-actions no-print"></div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

function documentsPage({ folders, documents, plates, counts, filters, sections = {},
                         message, nav }) {
  /* Every link on this page keeps the filters that are set, so opening a
     file for editing and closing it again lands exactly where it started. */
  const qs = (over = {}, bare = false) => {
    const p = new URLSearchParams();
    const v = { folder: filters.folder, plate: filters.plate, q: filters.q,
      exp: filters.exp, ...over };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    const s = p.toString();
    return (bare ? '/admin/documents' : '') + (s ? '?' + s : '');
  };
  const ret = '/admin/documents' + qs();
  const sel = filters.folder;
  const here = folders.find(f => String(f.id) === String(sel)) || null;
  /* The rail counts the whole cabinet; the list counts what the search left.
     When those two disagree the card between them has to say which it is
     giving, or the same screen prints two different numbers for one folder. */
  const narrowed = !!(filters.q || filters.plate);

  const rows = documents.map(d => {
    const editHref = `/admin/documents${qs({ edit: d.id })}#doc-${d.id}`;
    return String(d.id) === String(filters.edit)
      ? editRow(d, folders, plates, `${ret}#doc-${d.id}`, `${ret}#doc-${d.id}`)
      : readRow(d, editHref, ret);
  }).join('\n');

  const empty = filters.q || filters.plate
    ? 'Nothing matches that search.'
    : !counts.n
      ? 'No documents yet. Upload the first one in the form below.'
      : sel === 'none'
        ? 'Nothing is unfiled – every document is in a folder.'
        : sel
          ? 'This folder is empty. Upload something into it in the form below.'
          : 'No documents yet. Upload the first one in the form below.';

  /* The folder's own card: renaming and deleting a drawer belong to the
     drawer, not to a settings page somewhere else. */
  const folderCard = here ? `
  <div class="card">
    <div class="card-header">${FOLDER_ICON} ${esc(here.name)}
      <span class="step-tag">${esc(here.n)} ${here.n === 1 ? 'file' : 'files'} ·
        ${esc(size(here.bytes))}${narrowed && here.n !== documents.length
          ? ` · <em>${esc(documents.length)} shown, the search hides the rest</em>` : ''}${
          here.note ? ' · ' + esc(here.note) : ''}</span></div>
    <div class="card-body">
      <details class="doc-folder-edit">
        <summary>Rename this folder, or delete it</summary>
        <form class="nf" method="post" action="/admin/documents/folder/${esc(here.id)}">
          <input type="hidden" name="ret" value="${esc(ret)}">
          <div class="nf-grid">
            ${field('Name', `<input class="form-control" type="text" name="name" maxlength="80"
                required value="${esc(here.name)}">`)}
            ${field('What goes in it', `<input class="form-control" type="text" name="note"
                maxlength="200" value="${esc(here.note || '')}">`)}
          </div>
          <div class="actions" style="justify-content:flex-start;margin-top:12px">
            <button class="btn btn-primary" type="submit">Rename</button>
          </div>
        </form>
        <form method="post" action="/admin/documents/folder/${esc(here.id)}/delete">
          <input type="hidden" name="ret" value="/admin/documents">
          <div class="actions" style="justify-content:flex-start;margin-top:4px">
            <button class="btn btn-danger" type="submit">Delete this folder</button>
            <span class="muted">${here.n
              ? `The ${here.n} ${here.n === 1 ? 'file' : 'files'} in it are <strong>kept</strong> – they move to Unfiled.`
              : 'It is empty.'}</span>
          </div>
        </form>
      </details>
    </div>
  </div>` : '';

  const html = `  <div class="page-head">
    <h1>Documents</h1>
    <div class="muted">${esc(counts.n)} ${counts.n === 1 ? 'file' : 'files'} ·
      ${esc(counts.folders)} ${counts.folders === 1 ? 'folder' : 'folders'} ·
      ${esc(size(counts.bytes))}</div>
  </div>
${nav}
${message ? `<div class="ok-msg no-print">${esc(message)}</div>` : ''}
${sectionTabs('documents', sections, { keep: filters.exp || '' }, counts)}

  <p class="lede">Papers that belong to the fleet rather than to any one line in the
     ledger – leasing contracts, insurance, manuals, certificates, photographs of the yard.
     Nothing here is money and nothing here is counted in any total. Put files in
     <strong>folders you make yourself</strong>, and give one a
     <strong>registration number</strong> when it belongs to a particular van – then typing
     that plate in the box below brings up everything filed under it, whichever folder it
     sits in.</p>

  <div class="doc-wrap">
${folderRail(folders, counts, sel, qs)}

    <div class="doc-main">
      <form class="filters no-print" method="get" action="/admin/documents">
        <input type="hidden" name="folder" value="${esc(sel)}">
        ${filters.exp ? `<input type="hidden" name="exp" value="${esc(filters.exp)}">` : ''}
        <div class="f"><label for="q">Search</label>
          <input class="form-control" type="search" id="q" name="q" maxlength="80"
                 value="${esc(filters.q)}" placeholder="Name, note or file"></div>
        <div class="f"><label for="dplate">Vehicle</label>
          <input class="form-control mono" type="text" id="dplate" name="plate" maxlength="16"
                 list="doc-plate-filter" value="${esc(filters.plate)}" placeholder="Any"></div>
        <datalist id="doc-plate-filter">${plates.map(p =>
          `<option value="${esc(p)}"></option>`).join('')}</datalist>
        <button class="btn btn-primary" type="submit">Show</button>
        ${filters.q || filters.plate
          ? `<a class="btn btn-ghost" href="${esc('/admin/documents' + qs({ q: '', plate: '' }))}">Clear</a>` : ''}
        <a class="btn btn-ghost" href="#upload" title="Jump to the upload form">Upload ↓</a>
      </form>

${folderCard}

      <div class="card">
        <div class="card-header">${here ? esc(here.name) : sel === 'none' ? 'Unfiled' : 'All documents'}
          <span class="step-tag">${esc(documents.length)} ${documents.length === 1 ? 'file' : 'files'}${
            filters.plate ? ` · filed under ${esc(filters.plate)}` : ''}${
            filters.q ? ` · matching “${esc(filters.q)}”` : ''}</span></div>
        <div class="doc-scroll">
          <div class="doc-list">
${listHead()}
${rows || `<p class="muted" style="padding:20px">${empty}</p>`}
          </div>
        </div>
        ${documents.more ? `<div class="card-body"><p class="muted">Only the newest ${
          esc(documents.cap)} are shown. Pick a folder, or search, to see further back.</p></div>` : ''}
      </div>

      <div class="card nf-card" id="upload">
        <div class="card-header">Upload documents
          <span class="step-tag">Several at once · 25 MB each · any kind of file</span></div>
        <div class="card-body">
          <form class="nf" method="post" action="/admin/documents" enctype="multipart/form-data">
            <input type="hidden" name="ret" value="${esc(ret)}">
            <div class="nf-grid">
              ${field('Files *', `<input class="form-control nf-file" type="file" name="files"
                  multiple required title="Pick as many as you like – each becomes its own line.">`)}
              ${field('Folder', folderSelect(folders, sel === 'none' ? '' : sel))}
              ${field('Vehicle', plateBox(plates, filters.plate, 'doc-plates-new'))}
              ${field('Name', `<input class="form-control" type="text" name="title" maxlength="200"
                  placeholder="Left empty, each file keeps its own name">`)}
              ${field('Note', `<textarea class="form-control" name="note" rows="2" maxlength="2000"
                  placeholder="What these are, where they came from, when they run out"></textarea>`, 'nf-half')}
            </div>
            <div class="actions" style="justify-content:flex-start;margin-top:14px">
              <button class="btn btn-primary" type="submit">Upload</button>
              <span class="muted">Uploading more than one file with a name typed in numbers
                them – <em>Insurance (1)</em>, <em>Insurance (2)</em> – so nothing is lost.</span>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header">About this cabinet</div>
        <div class="card-body">
          <p><strong>Folders are yours.</strong> Make them, name them, rename them. Deleting one
             never deletes what is in it: the files move to <em>Unfiled</em>, where they can be
             put somewhere else. A folder is a label, and losing a label is not losing a
             document.</p>
          <p><strong>The vehicle is optional.</strong> Most of these papers belong to the company
             rather than to one van, so the box stays empty by default. Fill it in and the file
             is that van's as well – search the plate and it comes up, whatever folder it is
             filed in.</p>
          <p><strong>Nothing here is an expense.</strong> No cost, no SM check, nothing counted
             in any total on the tabs to the left. An invoice for work done on a van belongs on
             one of those tabs, on its own line, where it can be approved; a contract, a policy
             or a manual belongs here.</p>
          <p class="muted">Files are kept in the database with everything else, so a backup is a
             backup of these too. Images, PDFs and plain text open in the browser; anything else
             downloads.</p>
        </div>
      </div>
    </div>
  </div>`;

  return page({
    title: 'Documents – admin', body: html, links: LINKS,
    bodyClass: 'wide', lang: 'en', admin: true
  });
}

/** The confirmation page for deleting a file, as everywhere else in the app. */
function documentDeletePage({ doc, ret, nav }) {
  const back = ret || '/admin/documents';
  const html = `  <div class="page-head">
    <h1>Delete this document?</h1>
    <div class="muted mono">${esc([doc.folder_name || 'Unfiled', doc.plate,
      doc.filename].filter(Boolean).join(' · '))}</div>
  </div>
${nav}

  <div class="card card-warn">
    <div class="card-header">This will be removed</div>
    <div class="card-body">
      <p><strong>${esc(nameOf(doc))}</strong> · ${esc(size(doc.byte_size))} ·
         uploaded ${esc(fmtDateTime(doc.uploaded_at))}</p>
      ${doc.note ? `<p>${esc(doc.note)}</p>` : ''}
      <p>The file itself is deleted with the line. There is no copy of it anywhere else.</p>
    </div>
  </div>

  <form method="post" action="/admin/documents/${esc(doc.id)}/delete?confirm=1">
    <input type="hidden" name="ret" value="${esc(back)}">
    <div class="actions" style="justify-content:flex-start">
      <a class="btn btn-ghost" href="${esc(back)}">Cancel</a>
      <button class="btn btn-danger" type="submit">Delete the document</button>
    </div>
  </form>`;

  return page({ title: 'Delete document', body: html, links: LINKS, lang: 'en', admin: true });
}

module.exports = { documentsPage, documentDeletePage, size, nameOf };
