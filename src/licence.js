'use strict';
/**
 * Driver license control (Box) -- the Google form "Arrival Inspection Box",
 * pre-filled from the day's box assignment. Added 2026-09-28.
 *
 * The same control Route Suite has under Menu -> Export -> Driver license
 * control (Box) (lib/license-control-box.js in the extension), moved here so it
 * can be used from any browser with an admin login. Only the prefill-link half
 * travels: the extension's second path, filling a form tab that is already
 * open, needs a content script, and a web page cannot reach into another tab.
 *
 * Nothing in this file touches the database; the page and the tests both call
 * it, so what the link carries is decided in exactly one place.
 */

const FORM_ID = '1FAIpQLSfhF1u6mXWSNICHMrFr_uRg9xoQFySDkgheAtaaXwpaUhww7w';
const FORM_BASE = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`;

// Entry ids read off the live form on 2026-09-28. The four data fields carry
// the same ids as the Home control form it was copied from.
const ENTRY = {
  terminal: '2145116271',
  registration: '1069125218',
  route: '414178441',
  courier: '1449088697'
};

// The seven Yes/No/Övrigt questions, in the order the form shows them. They
// are pre-set to Yes exactly as the extension does -- and the page says, as
// the extension does, that they are the inspector's judgement and must be read
// and corrected on the form before Skicka.
const INSPECTION = [
  { entryId: '1672312795', label: 'Does the vehicle match the planned route?' },
  { entryId: '1186095297', label: 'Is the vehicle in good condition?' },
  { entryId: '1685393160', label: 'Tailgate lift inspected within the last 24 months?' },
  { entryId: '1835434897', label: 'Valid driving license?' },
  { entryId: '848372024', label: 'Does the driver match the planned route?' },
  { entryId: '1897586744', label: 'Is the driver wearing Instabee branded workwear?' },
  { entryId: '214106876', label: 'Tailgate lift operation permit?' }
];
const INSPECTION_ANSWER = 'Yes';

// The box form's own terminal list, spelled as the form spells it.
const TERMINALS = ['Jönköping', 'Mantorp', 'Karlstad', 'Växjö', 'Kalmar'];
// Route prefix -> terminal. Only the one that is known; anything else is left
// blank rather than guessed.
const TERMINAL_BY_PREFIX = { JKP: 'Jönköping' };

// The two staffing companies the Courier/Company field names, as Planday writes
// them after the tag: "(EXT) Flexio Abdo Ghannoum", "(BOX) Boxflow ...". Any
// other company is deliberately not recognised (his rule, 2026-09-28: "these
// two or none") -- its name stays in front of the person's.
const COMPANIES = ['Boxflow', 'Flexio'];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * "(EXT) Flexio Abdo Ghannoum" -> { tag:'EXT', company:'Flexio', name:'Abdo Ghannoum' }
 * A tagged name whose company is not in the list keeps everything after the
 * tag as the name: cutting an unknown company off by guesswork could take a
 * person's first name with it.
 */
function parseCourier(raw) {
  let s = String(raw == null ? '' : raw).trim();
  let tag = '';
  const m = s.match(/^[([]\s*([A-Za-z0-9]+)\s*[)\]]\s*/);
  if (m) { tag = m[1].toUpperCase(); s = s.slice(m[0].length); }
  let company = '';
  for (const c of COMPANIES) {
    if (norm(s.slice(0, c.length)) === norm(c) && /^\s/.test(s.slice(c.length))) {
      company = c;
      s = s.slice(c.length).trim();
      break;
    }
  }
  return { tag, company, name: s.trim() };
}

/** What goes in "Courier/Company name": "Abdo Ghannoum (Flexio)". */
function courierValue(p) {
  if (!p || !p.name) return '';
  return p.company ? `${p.name} (${p.company})` : p.name;
}

function terminalFromRoute(route) {
  const m = String(route || '').trim().toUpperCase().match(/^([A-Z]+)-/);
  return (m && TERMINAL_BY_PREFIX[m[1]]) || '';
}

/**
 * One option per assignment row. The courier comes from the Planday name the
 * extension pushed with the row (`courier`); rows pushed before that column
 * existed fall back to the roster name, with no company.
 */
function optionsFor(assignments) {
  return (assignments || [])
    .map(a => {
      const parsed = parseCourier(a.courier || a.driver || '');
      if (!parsed.name) parsed.name = String(a.driver || '').trim();
      return {
        route: String(a.route || '').trim(),
        plate: String(a.plate || '').trim(),
        driver: String(a.driver || '').trim(),
        courier: courierValue(parsed),
        company: parsed.company,
        tag: parsed.tag,
        terminal: terminalFromRoute(a.route)
      };
    })
    .sort((x, y) => x.route.localeCompare(y.route, 'sv', { numeric: true }) ||
                    x.plate.localeCompare(y.plate));
}

/** The prefill link. Empty values are left out rather than sent empty. */
function prefillUrl(values) {
  const v = values || {};
  const p = new URLSearchParams();
  p.set('usp', 'pp_url');
  const terminal = TERMINALS.includes(v.terminal) ? v.terminal : '';
  if (terminal) p.set('entry.' + ENTRY.terminal, terminal);
  if (v.registration) p.set('entry.' + ENTRY.registration, String(v.registration).trim());
  if (v.route) p.set('entry.' + ENTRY.route, String(v.route).trim());
  if (v.courier) p.set('entry.' + ENTRY.courier, String(v.courier).trim());
  INSPECTION.forEach(q => p.set('entry.' + q.entryId, INSPECTION_ANSWER));
  return FORM_BASE + '?' + p.toString();
}

module.exports = {
  FORM_ID, FORM_BASE, ENTRY, INSPECTION, INSPECTION_ANSWER, TERMINALS, COMPANIES,
  parseCourier, courierValue, terminalFromRoute, optionsFor, prefillUrl
};
