/**
 * Carry-forward engine for the Checklist Calendar.
 *
 * Rule, as specified by the operator:
 *   Every unticked item on a daily checklist is copied to the next working day.
 *   Saturday and Sunday are never a destination, so Friday rolls over to Monday.
 *   The chain starts on 2026-08-25 and never runs past the current day.
 *   The original day keeps its unticked item, so the record of what was still
 *   open on that day survives; the copy is what gets worked on next.
 *
 * The pass is idempotent. Every item carries an `originId` that stays the same
 * for the whole life of the chain, and a day never receives a second copy of an
 * origin it already holds. Running the pass a hundred times a day is therefore
 * indistinguishable from running it once.
 *
 * No dependencies; safe to import from server.mjs or to run stand-alone.
 */

export const DEFAULT_START_KEY = '2026-08-25';

/* ---------------------------------------------------------------- dates -- */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a YYYY-MM-DD key into a UTC-noon Date (noon keeps DST out of it). */
export function parseDayKey(key) {
  const match = DAY_KEY.exec(String(key || ''));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (Number.isNaN(date.getTime())) return null;
  // Reject impossible dates such as 2026-02-31, which Date silently rolls over.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

export function toDayKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addDayKey(key, days) {
  const date = parseDayKey(key);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDayKey(date);
}

/** 0 = Sunday - 6 = Saturday. */
export function weekdayOf(key) {
  const date = parseDayKey(key);
  return date ? date.getUTCDay() : null;
}

export function isWeekend(key) {
  const day = weekdayOf(key);
  return day === 0 || day === 6;
}

/** The first Monday-Friday strictly after `key`. Friday returns the Monday. */
export function nextWorkingDay(key) {
  let cursor = addDayKey(key, 1);
  for (let guard = 0; cursor && guard < 10; guard += 1) {
    if (!isWeekend(cursor)) return cursor;
    cursor = addDayKey(cursor, 1);
  }
  return null;
}

/** Today's calendar date in the machine's own time zone, as a day key. */
export function localTodayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- items -- */

function normalizeKeyOf(title) {
  return String(title || '').trim().toLowerCase();
}

const isDone = (item) => item?.done === true;

/**
 * Unfinished first, ticked at the bottom, original order kept inside each
 * group. Array.prototype.sort is stable, so equal items never swap places.
 */
export function sortItemsOpenFirst(section) {
  section.items = [...(section.items || [])].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
  return section;
}

/**
 * The identity an item keeps for the whole chain. Older records predate the
 * field, so the item's own id becomes its origin the first time it is seen.
 */
function originOf(item) {
  return item.originId || item.id;
}

/* ------------------------------------------------------------- the pass -- */

/**
 * @param {Array<object>} checklists  every stored checklist, any scope
 * @param {object} [options]
 * @param {string} [options.startKey]   first day the rule applies to
 * @param {string} [options.todayKey]   last day a copy may land on
 * @returns {{checklists: Array<object>, changed: boolean, moves: Array<object>}}
 */
export function carryForward(checklists, options = {}) {
  const startKey = options.startKey || DEFAULT_START_KEY;
  const todayKey = options.todayKey || localTodayKey();
  const working = JSON.parse(JSON.stringify(Array.isArray(checklists) ? checklists : []));
  const moves = [];
  let changed = false;

  if (!parseDayKey(startKey) || !parseDayKey(todayKey) || todayKey < startKey) {
    return { checklists: working, changed: false, moves };
  }

  const byDayKey = new Map();
  for (const checklist of working) {
    if (checklist?.scope === 'day' && typeof checklist.key === 'string') {
      byDayKey.set(checklist.key, checklist);
    }
  }

  // Stamp the origin on every day item that predates the feature, once.
  for (const checklist of byDayKey.values()) {
    for (const section of checklist.sections || []) {
      for (const item of section.items || []) {
        if (!item.originId) {
          item.originId = item.id;
          changed = true;
        }
      }
    }
  }

  for (let sourceKey = startKey; sourceKey <= todayKey; sourceKey = addDayKey(sourceKey, 1)) {
    const source = byDayKey.get(sourceKey);
    if (!source) continue;

    const targetKey = nextWorkingDay(sourceKey);
    if (!targetKey || targetKey > todayKey) continue;

    const open = [];
    for (const section of source.sections || []) {
      for (const item of section.items || []) {
        if (!isDone(item) && String(item.action || '').trim()) {
          open.push({ item, sectionTitle: section.title });
        }
      }
    }
    if (!open.length) continue;

    let target = byDayKey.get(targetKey);
    const targetIsNew = !target;
    if (targetIsNew) {
      target = createDayFrom(source, targetKey);
    }

    const held = new Set();
    for (const section of target.sections || []) {
      for (const item of section.items || []) held.add(originOf(item));
    }

    let added = 0;
    const touched = new Set();
    for (const { item, sectionTitle } of open) {
      const origin = originOf(item);

      // `forwardedTo` is stamped on the SOURCE item, so a copy the operator
      // deletes on the target day stays deleted instead of reappearing at the
      // next sweep. It is the authority; `held` only back-fills the stamp for
      // chains that were built before this field existed.
      if (item.forwardedTo === targetKey) continue;
      if (held.has(origin)) {
        item.forwardedTo = targetKey;
        changed = true;
        continue;
      }

      held.add(origin);
      const section = sectionFor(target, sectionTitle);
      section.items.push(carriedCopy(item, sourceKey, targetKey));
      touched.add(section);
      item.forwardedTo = targetKey;
      added += 1;
      moves.push({
        from: sourceKey,
        to: targetKey,
        action: item.action,
        originId: origin,
        firstSeen: item.carriedFrom || sourceKey
      });
    }

    if (added) {
      // A copy appended after a ticked item would otherwise sit below it.
      for (const section of touched) sortItemsOpenFirst(section);
      target.updatedAt = new Date().toISOString();
      changed = true;
      if (targetIsNew) {
        working.push(target);
        byDayKey.set(targetKey, target);
      }
    }
  }

  return { checklists: working, changed, moves };
}

function createDayFrom(source, targetKey) {
  return {
    id: `day:${targetKey}`,
    scope: 'day',
    key: targetKey,
    title: source.title || 'Approved Daily Substitute Checklist',
    revision: targetKey,
    mode: source.mode || 'DO-CONFIRM',
    primaryRole: source.primaryRole || "SUBSTITUTE'S DUTIES IN RED",
    secondaryRole: source.secondaryRole || 'SUPPORT DUTIES IN BLACK',
    sections: [],
    comments: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'carry-forward'
  };
}

/** The target section with this title, created at the end if it is missing. */
function sectionFor(checklist, title) {
  checklist.sections ||= [];
  const wanted = normalizeKeyOf(title) || 'carried over';
  const existing = checklist.sections.find((section) => normalizeKeyOf(section.title) === wanted);
  if (existing) {
    existing.items ||= [];
    return existing;
  }
  /* Derived for the same reason a carried item's id is: the section a rollover
     creates has to come out identical on both servers. `comments` is keyed by
     section id, so this is a storage key -- it is only ever assigned to a
     section being created here and now, never rewritten on an existing one. */
  const created = {
    id: `section-${checklist.key || 'x'}-${wanted.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carried'}`,
    title: String(title || 'Carried Over').trim() || 'Carried Over',
    items: []
  };
  checklist.sections.push(created);
  return created;
}

/**
 * The id of a carried copy is DERIVED, not random.
 *
 * Two servers now run this pass over the same calendar: the one on his machine
 * and the copy on Railway, and either may be the only one awake when a day
 * rolls over. A random id would let both produce a copy of the same item, and
 * the two copies would differ in nothing a merge could use to tell they were
 * the same thing. Derived from the chain's origin and the day it lands on,
 * both sides produce the identical record, and "already carried" is decidable
 * without either side having heard from the other.
 *
 * Unique for the same reason the old one was: an origin is carried to a given
 * day at most once -- `held` and `forwardedTo` both enforce it.
 */
function carriedId(item, targetKey) {
  return `item-${originOf(item)}-${targetKey}`;
}

function carriedCopy(item, sourceKey, targetKey) {
  return {
    id: carriedId(item, targetKey),
    action: item.action,
    state: item.state || 'COMPLETE',
    role: item.role === 'secondary' ? 'secondary' : 'primary',
    done: false,
    originId: originOf(item),
    carriedFrom: item.carriedFrom || sourceKey,
    carriedOn: targetKey,
    carryCount: Number(item.carryCount || 0) + 1
  };
}
