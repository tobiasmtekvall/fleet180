/* Weekly vehicle maintenance matrix — the data half.
 *
 * Everything in this file is pure: no DOM, no fetch, no Date.now() except where
 * a caller passes the clock in. `fleet.js` owns the screen, `server.mjs` owns
 * the file; both import their facts from here so the checkpoint list, the state
 * machine and the report can be unit-tested without a browser.
 *
 * WHY A SEPARATE STORE FROM checklists.json
 * -----------------------------------------
 * The calendar's own records are validated by `validChecklist()`, which only
 * accepts scope day/week/month with a `sections` array. A fleet week is a
 * different shape, and — more importantly — Tobias works in the calendar in the
 * morning while the carry-forward sweep rewrites checklists.json underneath him.
 * Adding a second writer to that file would put the matrix in the middle of a
 * race that memory already records as having eaten data once. The matrix gets
 * its own file, its own lock and its own endpoints.
 *
 * PLATES ARE NOT GUESSED
 * ----------------------
 * The fifteen box vans and their owners are copied from vehicles/matrix-defaults.js;
 * the six home vans from vehicles/home-defaults.js. The home vans deliberately
 * carry NO owner — nobody has said who owns them, and an invented owner beside a
 * real registration is exactly the failure the Home tab is shaped around. Empty
 * string means "not stated", never "no owner" and never "rental".
 */

export const OWNER_LABEL = Object.freeze({ own: 'Own', okq8: 'OKQ8', '': '—' });

export const FLEETS = Object.freeze([
  {
    id: 'box',
    title: 'Box fleet — Säkerhetskontroll B-bil',
    note: 'Routes JKP-EM-n-RR. Seven own, eight hired from OKQ8.',
    vehicles: [
      { plate: 'ODW03R', owner: 'okq8' },
      { plate: 'RBE87T', owner: 'okq8' },
      { plate: 'XWA50L', owner: 'okq8' },
      { plate: 'BPM38R', owner: 'okq8' },
      { plate: 'ESJ01Y', owner: 'okq8' },
      { plate: 'HJA34R', owner: 'okq8' },
      { plate: 'BBR00N', owner: 'okq8' },
      { plate: 'WAT90D', owner: 'okq8' },
      { plate: 'RBE26H', owner: 'own' },
      { plate: 'RPH54L', owner: 'own' },
      { plate: 'DHN13H', owner: 'own' },
      { plate: 'GJR88K', owner: 'own' },
      { plate: 'ELZ35L', owner: 'own' },
      { plate: 'SSB55B', owner: 'own' },
      { plate: 'ODJ63H', owner: 'own' }
    ]
  },
  {
    id: 'home',
    title: 'Home delivery fleet',
    note: 'Numeric Budbee route ids. Ownership has not been stated for these six.',
    vehicles: [
      { plate: 'MER05W', owner: '' },
      { plate: 'BZU92Z', owner: '' },
      // Was RLX94L here and in Fleet 180 until 2026-09-16. No such
      // registration exists; the van is RLX94A. The two halves of the app
      // have to call it the same thing, or the checkpoint history in
      // calendar_fleet_weeks (keyed by plate) is filed under a van the
      // safety check no longer knows. Whatever was recorded against the old
      // key stays under it and is not shown.
      { plate: 'RLX94A', owner: '' },
      { plate: 'CDK93M', owner: '' },
      { plate: 'DTE97W', owner: '' },
      { plate: 'WBH37M', owner: '' }
    ]
  }
]);

export function allVehicles() {
  return FLEETS.flatMap((fleet) => fleet.vehicles.map((vehicle) => ({ ...vehicle, fleet: fleet.id })));
}

/* ------------------------------------------------------------------ *
 * The checkpoints.
 *
 * Seeded by the Jönköping Säkerhetskontroll B-bil form — every question on it
 * appears here — then extended to the ordinary failures a Nordic last-mile van
 * actually presents with. Left and right are separate columns wherever a lamp
 * or a corner can fail on its own, because "the lights work" is not an
 * inspection result and "left rear indicator" is what gets ordered.
 *
 * `id` is a storage key. Once a week has been filled in, renaming an id orphans
 * its cells — add new ids instead, never repurpose an old one.
 * `form: true` marks a checkpoint the driver's daily safety form also asks about.
 * ------------------------------------------------------------------ */
export const GROUPS = Object.freeze([
  {
    id: 'lights',
    title: 'Exterior lighting',
    short: 'Lights',
    checkpoints: [
      { id: 'lo-l', label: 'Low beam — left', form: true },
      { id: 'lo-r', label: 'Low beam — right', form: true },
      { id: 'hi-l', label: 'High beam — left', form: true },
      { id: 'hi-r', label: 'High beam — right', form: true },
      { id: 'drl-l', label: 'Daytime running light — left' },
      { id: 'drl-r', label: 'Daytime running light — right' },
      { id: 'ffog-l', label: 'Front fog light — left' },
      { id: 'ffog-r', label: 'Front fog light — right' },
      { id: 'ind-fl', label: 'Indicator — front left', form: true },
      { id: 'ind-fr', label: 'Indicator — front right', form: true },
      { id: 'ind-rl', label: 'Indicator — rear left', form: true },
      { id: 'ind-rr', label: 'Indicator — rear right', form: true },
      { id: 'rep-l', label: 'Side repeater — left' },
      { id: 'rep-r', label: 'Side repeater — right' },
      { id: 'tail-l', label: 'Tail light — left', form: true },
      { id: 'tail-r', label: 'Tail light — right', form: true },
      { id: 'brk-l', label: 'Brake light — left', form: true },
      { id: 'brk-r', label: 'Brake light — right', form: true },
      { id: 'brk-h', label: 'High-level brake light', form: true },
      { id: 'rev-l', label: 'Reversing light — left' },
      { id: 'rev-r', label: 'Reversing light — right' },
      { id: 'rfog', label: 'Rear fog light' },
      { id: 'plate-lamp', label: 'Number plate light' },
      { id: 'pos-side', label: 'Side position / marker lamps', form: true },
      { id: 'hazard', label: 'Hazard warning flashers' },
      { id: 'cargo-lamp', label: 'Load compartment light' },
      { id: 'work-lamp', label: 'Work light / beacon (if fitted)' },
      { id: 'headlamp-aim', label: 'Headlight aim & lens clarity' }
    ]
  },
  {
    id: 'fluids',
    title: 'Fluids & consumables',
    short: 'Fluids',
    checkpoints: [
      { id: 'oil-level', label: 'Engine oil — level', form: true },
      { id: 'oil-leak', label: 'Engine oil — leaks' },
      { id: 'coolant', label: 'Coolant / glycol — level', form: true },
      { id: 'coolant-leak', label: 'Coolant — leaks' },
      { id: 'brakefluid', label: 'Brake fluid — level' },
      { id: 'washer', label: 'Washer fluid (spolarvätska)', form: true },
      { id: 'washer-winter', label: 'Washer fluid — winter grade (−18 °C)' },
      { id: 'steer-fluid', label: 'Power steering fluid' },
      { id: 'gearbox', label: 'Gearbox / transmission fluid' },
      { id: 'adblue', label: 'AdBlue — level above 30 %', form: true },
      { id: 'fuel', label: 'Fuel / HVO — tank full', form: true }
    ]
  },
  {
    id: 'tyres',
    title: 'Tyres & wheels',
    short: 'Tyres',
    checkpoints: [
      { id: 'tyre-fl', label: 'Tread depth — front left', form: true },
      { id: 'tyre-fr', label: 'Tread depth — front right', form: true },
      { id: 'tyre-rl', label: 'Tread depth — rear left', form: true },
      { id: 'tyre-rr', label: 'Tread depth — rear right', form: true },
      { id: 'press-all', label: 'Tyre pressure — all round' },
      { id: 'tyre-damage', label: 'Sidewall cuts, bulges, kerb damage' },
      { id: 'wheelnuts', label: 'Wheel nuts / torque' },
      { id: 'season', label: 'Correct seasonal tyres fitted' },
      { id: 'spare', label: 'Spare wheel / puncture kit' },
      { id: 'jack', label: 'Jack & wheel brace' }
    ]
  },
  {
    id: 'brakes',
    title: 'Brakes, steering & suspension',
    short: 'Brakes',
    checkpoints: [
      { id: 'brake-feel', label: 'Service brake — pedal feel & travel' },
      { id: 'brake-pull', label: 'Braking — pulls to one side' },
      { id: 'brake-noise', label: 'Brake noise / grinding' },
      { id: 'pads', label: 'Pad & disc wear' },
      { id: 'handbrake', label: 'Parking brake — holds on slope' },
      { id: 'steer-play', label: 'Steering play' },
      { id: 'steer-pull', label: 'Tracking / pulls when straight' },
      { id: 'suspension', label: 'Suspension & shock absorbers' },
      { id: 'bearings', label: 'Wheel bearing noise' },
      { id: 'exhaust', label: 'Exhaust — leaks & mounting' }
    ]
  },
  {
    id: 'vision',
    title: 'Glass, mirrors & vision',
    short: 'Vision',
    checkpoints: [
      { id: 'screen', label: 'Windscreen — chips & cracks' },
      { id: 'wiper-fd', label: 'Wiper blade — front driver side', form: true },
      { id: 'wiper-fp', label: 'Wiper blade — front passenger side', form: true },
      { id: 'wiper-rear', label: 'Wiper blade — rear' },
      { id: 'wiper-motor', label: 'Wiper operation — all speeds', form: true },
      { id: 'jets', label: 'Washer jets & pump' },
      { id: 'mirror-l', label: 'Mirror — left' },
      { id: 'mirror-r', label: 'Mirror — right' },
      { id: 'mirror-int', label: 'Interior / load compartment mirror' },
      { id: 'revcam', label: 'Reversing camera', form: true },
      { id: 'sensors', label: 'Parking sensors' },
      { id: 'demist', label: 'Demister, heater & A/C' },
      { id: 'horn', label: 'Horn' }
    ]
  },
  {
    id: 'cab',
    title: 'Cab, safety equipment & documents',
    short: 'Cab',
    checkpoints: [
      { id: 'belt-driver', label: 'Seat belt & lock — driver', form: true },
      { id: 'belt-pass', label: 'Seat belt & lock — passenger', form: true },
      { id: 'seat', label: 'Seat & adjustment' },
      { id: 'dashlights', label: 'Warning lamps on instrument panel', form: true },
      { id: 'clean', label: 'Cab clean, no loose objects', form: true },
      { id: 'triangle', label: 'Warning triangle' },
      { id: 'vest', label: 'Hi-vis vest' },
      { id: 'firstaid', label: 'First aid kit' },
      { id: 'extinguisher', label: 'Fire extinguisher' },
      { id: 'scraper', label: 'Ice scraper / snow brush' },
      { id: 'straps', label: 'Load securing straps' },
      { id: 'docs', label: 'Registration & insurance documents' },
      { id: 'keys', label: 'Keys & spare key / fob' },
      { id: 'phone-mount', label: 'Phone mount & charger' },
      { id: 'scanner', label: 'Scanner / terminal cradle' }
    ]
  },
  {
    id: 'body',
    title: 'Bodywork & exterior inspection',
    short: 'Bodywork',
    checkpoints: [
      { id: 'walkaround', label: 'Full walk-around bodywork inspection', form: true },
      { id: 'panels-front', label: 'Front panel & bumper' },
      { id: 'panels-rear', label: 'Rear panel & bumper' },
      { id: 'panels-left', label: 'Left side panels & sill' },
      { id: 'panels-right', label: 'Right side panels & sill' },
      { id: 'roof', label: 'Roof & gutters' },
      { id: 'rust', label: 'Rust / corrosion' },
      { id: 'graphics', label: 'Livery & decals' },
      { id: 'doors-front', label: 'Front doors & locks' },
      { id: 'door-slide', label: 'Sliding door — runners & lock' },
      { id: 'doors-rear', label: 'Rear / barn doors & locks' },
      { id: 'cargo-floor', label: 'Load compartment floor & lining' },
      { id: 'bulkhead', label: 'Bulkhead & load barrier' },
      { id: 'tailgate', label: 'Tail lift (bakgavellyft) — operation', form: true },
      { id: 'tailgate-hyd', label: 'Tail lift — hydraulics & leaks', form: true },
      { id: 'underrun', label: 'Underrun bar' },
      { id: 'mudflaps', label: 'Mud flaps' },
      { id: 'towbar', label: 'Tow bar / hitch' },
      { id: 'fuelcap', label: 'Fuel & AdBlue filler caps' }
    ]
  },
  {
    id: 'mech',
    title: 'Engine bay, electrics & service',
    short: 'Engine',
    checkpoints: [
      { id: 'battery', label: 'Battery & terminals' },
      { id: 'charging', label: 'Charging / alternator' },
      { id: 'start', label: 'Cold start' },
      { id: 'engine-noise', label: 'Engine noise & idle' },
      { id: 'smoke', label: 'Exhaust smoke' },
      { id: 'dpf', label: 'DPF / AdBlue system fault' },
      { id: 'belt', label: 'Drive belt' },
      { id: 'hoses', label: 'Hoses & clamps' },
      { id: 'airfilter', label: 'Air filter' },
      { id: 'cabinfilter', label: 'Cabin / pollen filter' },
      { id: 'sockets', label: '12 V sockets & USB' },
      { id: 'wiring', label: 'Visible wiring & connectors' },
      { id: 'service', label: 'Service interval due' },
      { id: 'besiktning', label: 'Besiktning (inspection) due' },
      { id: 'tracker', label: 'Telematics / tracker online' },
      { id: 'damage-report', label: 'Damage reported to manager' }
    ]
  }
]);

export const CHECKPOINTS = Object.freeze(
  GROUPS.flatMap((group) => group.checkpoints.map((cp) => ({ ...cp, group: group.id, groupTitle: group.title })))
);

const CHECKPOINT_BY_ID = new Map(CHECKPOINTS.map((cp) => [cp.id, cp]));
export function checkpoint(id) { return CHECKPOINT_BY_ID.get(id) || null; }
export function checkpointLabel(id) { return CHECKPOINT_BY_ID.get(id)?.label || id; }

/* ------------------------------------------------------------------ *
 * The state machine.
 *
 * Yellow is the resting state and it means NOT LOOKED AT YET — never "fine".
 * That is the whole point of the colour: a week that was never worked shows as
 * a wall of yellow, and the report can say so honestly. Green has to be earned,
 * either one cell at a time or with the "All OK" button.
 * ------------------------------------------------------------------ */
export const STATES = Object.freeze(['pending', 'ok', 'minor', 'urgent']);
export const STATE_META = Object.freeze({
  pending: { label: 'Not inspected', short: 'Not inspected', tone: 'pending' },
  ok: { label: 'OK', short: 'OK', tone: 'ok' },
  minor: { label: 'Needs attention (minor)', short: 'Minor', tone: 'minor' },
  urgent: { label: 'Needs fixing (urgent)', short: 'Urgent', tone: 'urgent' }
});

export function nextState(state) {
  const index = STATES.indexOf(state || 'pending');
  return STATES[(index < 0 ? 0 : index + 1) % STATES.length];
}

export function previousState(state) {
  const index = STATES.indexOf(state || 'pending');
  return STATES[((index < 0 ? 0 : index) - 1 + STATES.length) % STATES.length];
}

export function isFault(state) { return state === 'minor' || state === 'urgent'; }

/** Worst state in a list, ranked urgent > minor > pending > ok. */
export function worstState(states) {
  let worst = 'ok';
  for (const state of states) {
    if (state === 'urgent') return 'urgent';
    if (state === 'minor') worst = 'minor';
    else if (state === 'pending' && worst !== 'minor') worst = 'pending';
  }
  return worst;
}

export function cellKey(plate, checkpointId) { return `${plate}|${checkpointId}`; }

/* ------------------------------------------------------------------ *
 * Spare parts — the everyday consumables a fleet manager orders without
 * booking a workshop slot. Grouped so the drop-down is scannable.
 * ------------------------------------------------------------------ */
export const SPARE_PARTS = Object.freeze([
  { group: 'Bulbs & lamps', items: [
    'Low beam bulb (H7)', 'High beam bulb (H1)', 'Fog light bulb (H11)',
    'Indicator bulb (PY21W)', 'Brake / tail bulb (P21/5W)', 'Reversing bulb (W16W)',
    'Number plate bulb (C5W)', 'Side marker bulb (W5W)', 'LED lamp unit',
    'Complete bulb kit'
  ] },
  { group: 'Wipers & glass', items: [
    'Wiper blade — front driver side', 'Wiper blade — front passenger side',
    'Wiper blade — rear', 'Wiper arm', 'Washer jet', 'Mirror glass', 'Mirror housing'
  ] },
  { group: 'Fluids', items: [
    'Washer fluid — winter (−18 °C)', 'Washer fluid — summer', 'Engine oil 5W-30',
    'Coolant / glycol', 'Brake fluid DOT 4', 'AdBlue 10 L', 'Power steering fluid',
    'Tail lift hydraulic oil'
  ] },
  { group: 'Filters & service', items: [
    'Cabin / pollen filter', 'Air filter', 'Oil filter', 'Fuel filter', 'Drive belt'
  ] },
  { group: 'Tyres & wheels', items: [
    'Tyre — summer', 'Tyre — winter', 'Wheel nut', 'Tyre valve', 'Puncture repair kit', 'Wheel trim'
  ] },
  { group: 'Electrical', items: [
    '12 V battery', 'Fuse set', 'Relay', '12 V socket', 'USB charger', 'Key fob battery'
  ] },
  { group: 'Body & fittings', items: [
    'Mud flap', 'Door handle', 'Door lock barrel', 'Sliding door roller', 'Gas strut',
    'Wheel arch trim', 'Number plate holder', 'Fuel filler cap'
  ] },
  { group: 'Cab & equipment', items: [
    'Load securing strap', 'Floor mat', 'Ice scraper', 'Hi-vis vest', 'Warning triangle',
    'First aid kit', 'Fire extinguisher', 'Phone mount', 'Scanner cradle'
  ] }
]);

export const SPARE_PART_NAMES = Object.freeze(SPARE_PARTS.flatMap((group) => group.items));

/* ------------------------------------------------------------------ *
 * Week records.
 * ------------------------------------------------------------------ */
export function fleetRecordId(weekKey) { return `fleet:${weekKey}`; }

export function emptyRecord(weekKey, nowIso = new Date().toISOString()) {
  return {
    id: fleetRecordId(weekKey),
    scope: 'fleet',
    key: weekKey,
    cells: {},
    comments: {},
    parts: {},
    events: [],
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

/** Defensive read: an older or hand-edited record still has to open. */
export function normalizeRecord(record, weekKey) {
  const base = emptyRecord(weekKey || record?.key || '', record?.createdAt || new Date().toISOString());
  if (!record || typeof record !== 'object') return base;
  const cells = {};
  for (const [key, value] of Object.entries(record.cells || {})) {
    if (!value || typeof value !== 'object') continue;
    const state = STATES.includes(value.state) ? value.state : 'pending';
    if (state === 'pending') continue;              // pending is the absence of a cell
    cells[key] = { state, at: typeof value.at === 'string' ? value.at : null };
  }
  const comments = {};
  for (const [plate, text] of Object.entries(record.comments || {})) {
    if (typeof text === 'string' && text.trim()) comments[plate] = text.slice(0, 4000);
  }
  const parts = {};
  for (const [plate, list] of Object.entries(record.parts || {})) {
    if (!Array.isArray(list)) continue;
    const unique = [...new Set(list.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.slice(0, 120)))];
    if (unique.length) parts[plate] = unique.slice(0, 60);
  }
  const events = (Array.isArray(record.events) ? record.events : [])
    .filter((event) => event && typeof event === 'object' && typeof event.t === 'string' && typeof event.plate === 'string')
    .slice(-MAX_EVENTS);
  return {
    ...base,
    id: fleetRecordId(weekKey || record.key || ''),
    key: weekKey || record.key || base.key,
    cells,
    comments,
    parts,
    events,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : base.createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : base.updatedAt
  };
}

export const MAX_EVENTS = 6000;

export function cellState(record, plate, checkpointId) {
  return record?.cells?.[cellKey(plate, checkpointId)]?.state || 'pending';
}

export function cellStamp(record, plate, checkpointId) {
  return record?.cells?.[cellKey(plate, checkpointId)]?.at || null;
}

/**
 * Write one cell and log the transition.
 *
 * Mutates `record` in place and returns the event it appended, or null when the
 * state did not actually change (so a re-render or a double event never grows
 * the log). The log is what the weekly report's timestamps are made of, so it
 * records the transition, not just the landing state.
 */
export function setCell(record, plate, checkpointId, state, nowIso = new Date().toISOString(), source = 'click') {
  if (!STATES.includes(state)) return null;
  const key = cellKey(plate, checkpointId);
  const from = record.cells[key]?.state || 'pending';
  if (from === state) return null;
  if (state === 'pending') delete record.cells[key];
  else record.cells[key] = { state, at: nowIso };
  const event = { t: nowIso, plate, cp: checkpointId, from, to: state, src: source };
  pushEvent(record, event);
  record.updatedAt = nowIso;
  return event;
}

/** Append to the log, trimming the oldest entries once the cap is reached. */
function pushEvent(record, event) {
  record.events.push(event);
  if (record.events.length > MAX_EVENTS) record.events.splice(0, record.events.length - MAX_EVENTS);
  return event;
}

/**
 * A bulk sweep over the matrix.
 *
 * ONE log entry, not one per cell. A whole-matrix "all OK" moves 2,559
 * checkpoints; logging each would bury the handful of clicks that actually mean
 * something and would spend the entire event cap on a single button press. The
 * per-cell timestamp still lands on the cell itself, so nothing is lost — the
 * report reads times off the cells and reads intent off the log.
 */
function bulkSweep(record, { from, to, plates, nowIso, src }) {
  const targets = plates ? new Set(plates) : null;
  let changed = 0;
  for (const vehicle of allVehicles()) {
    if (targets && !targets.has(vehicle.plate)) continue;
    for (const cp of CHECKPOINTS) {
      if (cellState(record, vehicle.plate, cp.id) !== from) continue;
      const key = cellKey(vehicle.plate, cp.id);
      if (to === 'pending') delete record.cells[key];
      else record.cells[key] = { state: to, at: nowIso };
      changed += 1;
    }
  }
  if (changed) {
    pushEvent(record, {
      t: nowIso,
      plate: plates && plates.length === 1 ? plates[0] : 'ALL',
      cp: null,
      from,
      to,
      src,
      count: changed,
      scope: plates ? plates.join(', ') : 'whole matrix'
    });
    record.updatedAt = nowIso;
  }
  return changed;
}

/**
 * "All OK" — every cell still resting at yellow becomes green.
 *
 * Deliberately only touches pending cells: a fault already marked is never
 * cleared by a bulk action, because the one thing this button must not do is
 * quietly erase the reason somebody is booking a workshop. Scope it with
 * `plates` (one row) or leave it out for the whole matrix.
 */
export function markAllOk(record, { plates = null, nowIso = new Date().toISOString() } = {}) {
  return bulkSweep(record, { from: 'pending', to: 'ok', plates, nowIso, src: 'bulk-ok' });
}

/** Undo of the above: green cells put back to yellow. Faults are again untouched. */
export function resetOkToPending(record, { plates = null, nowIso = new Date().toISOString() } = {}) {
  return bulkSweep(record, { from: 'ok', to: 'pending', plates, nowIso, src: 'bulk-reset' });
}

export function setComment(record, plate, text, nowIso = new Date().toISOString()) {
  const value = String(text ?? '').slice(0, 4000);
  if (value.trim()) record.comments[plate] = value;
  else delete record.comments[plate];
  record.updatedAt = nowIso;
}

export function addPart(record, plate, part, nowIso = new Date().toISOString()) {
  const name = String(part ?? '').trim().slice(0, 120);
  if (!name) return false;
  const list = record.parts[plate] || [];
  if (list.includes(name)) return false;
  record.parts[plate] = [...list, name].slice(0, 60);
  pushEvent(record, { t: nowIso, plate, cp: null, from: null, to: null, part: name, src: 'part-add' });
  record.updatedAt = nowIso;
  return true;
}

export function removePart(record, plate, part, nowIso = new Date().toISOString()) {
  const list = record.parts[plate] || [];
  if (!list.includes(part)) return false;
  const next = list.filter((item) => item !== part);
  if (next.length) record.parts[plate] = next;
  else delete record.parts[plate];
  pushEvent(record, { t: nowIso, plate, cp: null, from: null, to: null, part, src: 'part-remove' });
  record.updatedAt = nowIso;
  return true;
}

/* ------------------------------------------------------------------ *
 * Tallies and the report.
 * ------------------------------------------------------------------ */
export function vehicleTally(record, plate) {
  const tally = { ok: 0, minor: 0, urgent: 0, pending: 0, total: CHECKPOINTS.length };
  for (const cp of CHECKPOINTS) tally[cellState(record, plate, cp.id)] += 1;
  tally.inspected = tally.total - tally.pending;
  tally.faults = tally.minor + tally.urgent;
  return tally;
}

export function groupTally(record, plate, groupId) {
  const group = GROUPS.find((entry) => entry.id === groupId);
  const tally = { ok: 0, minor: 0, urgent: 0, pending: 0, total: group ? group.checkpoints.length : 0 };
  for (const cp of group?.checkpoints || []) tally[cellState(record, plate, cp.id)] += 1;
  tally.faults = tally.minor + tally.urgent;
  tally.worst = worstState((group?.checkpoints || []).map((cp) => cellState(record, plate, cp.id)));
  return tally;
}

export function matrixTally(record) {
  const totals = { ok: 0, minor: 0, urgent: 0, pending: 0, total: 0, vehicles: 0, vehiclesTouched: 0, vehiclesComplete: 0 };
  for (const vehicle of allVehicles()) {
    const tally = vehicleTally(record, vehicle.plate);
    totals.ok += tally.ok;
    totals.minor += tally.minor;
    totals.urgent += tally.urgent;
    totals.pending += tally.pending;
    totals.total += tally.total;
    totals.vehicles += 1;
    if (tally.inspected > 0) totals.vehiclesTouched += 1;
    if (tally.pending === 0) totals.vehiclesComplete += 1;
  }
  totals.inspected = totals.total - totals.pending;
  totals.faults = totals.minor + totals.urgent;
  totals.percent = totals.total ? Math.round((totals.inspected / totals.total) * 100) : 0;
  return totals;
}

/**
 * The weekly maintenance report, as data.
 *
 * `fleet.js` turns this into a page and a printable sheet; the tests read it
 * directly. Two things it must always be honest about: every state change
 * carries the timestamp it happened at, and anything still yellow is reported
 * as NOT DONE rather than quietly folded into the OK count.
 */
export function buildReport(record, { weekKey, weekLabel = '', generatedAt = new Date().toISOString() } = {}) {
  const totals = matrixTally(record);
  const vehicles = allVehicles().map((vehicle) => {
    const tally = vehicleTally(record, vehicle.plate);
    const faults = [];
    const outstanding = [];
    for (const cp of CHECKPOINTS) {
      const state = cellState(record, vehicle.plate, cp.id);
      if (isFault(state)) {
        faults.push({ id: cp.id, label: cp.label, group: cp.groupTitle, state, at: cellStamp(record, vehicle.plate, cp.id) });
      } else if (state === 'pending') {
        outstanding.push({ id: cp.id, label: cp.label, group: cp.groupTitle });
      }
    }
    faults.sort((a, b) => (a.state === b.state ? 0 : a.state === 'urgent' ? -1 : 1));
    const stamps = CHECKPOINTS
      .map((cp) => cellStamp(record, vehicle.plate, cp.id))
      .filter(Boolean)
      .sort();
    return {
      plate: vehicle.plate,
      fleet: vehicle.fleet,
      owner: vehicle.owner,
      ownerLabel: OWNER_LABEL[vehicle.owner] ?? '—',
      tally,
      faults,
      outstanding,
      outstandingByGroup: GROUPS
        .map((group) => ({ group: group.title, count: groupTally(record, vehicle.plate, group.id).pending }))
        .filter((entry) => entry.count > 0),
      parts: record.parts?.[vehicle.plate] || [],
      comment: record.comments?.[vehicle.plate] || '',
      firstCheckedAt: stamps[0] || null,
      lastCheckedAt: stamps[stamps.length - 1] || null,
      status: tally.inspected === 0 ? 'not-started' : tally.pending > 0 ? 'incomplete' : tally.faults > 0 ? 'complete-with-faults' : 'complete'
    };
  });

  const events = [...(record.events || [])]
    .filter((event) => event && event.t)
    .sort((a, b) => String(a.t).localeCompare(String(b.t)))
    .map((event) => ({
      ...event,
      label: event.cp ? checkpointLabel(event.cp) : null
    }));

  return {
    weekKey: weekKey || record.key,
    weekLabel,
    generatedAt,
    totals,
    vehicles,
    events,
    faults: vehicles.flatMap((vehicle) => vehicle.faults.map((fault) => ({ ...fault, plate: vehicle.plate }))),
    worked: vehicles.filter((vehicle) => vehicle.tally.inspected > 0),
    notCompleted: vehicles.filter((vehicle) => vehicle.tally.pending > 0),
    untouched: vehicles.filter((vehicle) => vehicle.tally.inspected === 0),
    partsRequested: vehicles.filter((vehicle) => vehicle.parts.length).map((vehicle) => ({ plate: vehicle.plate, parts: vehicle.parts }))
  };
}
