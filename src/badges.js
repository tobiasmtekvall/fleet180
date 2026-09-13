'use strict';

/**
 * The marks a driver can earn beside their percentage.
 *
 * A percentage says whether the check was filed. These say something the
 * percentage cannot: that it was filled in by somebody who was looking. They
 * are deliberately few, deliberately hard to earn by accident, and every one
 * of them is computed from what the driver actually wrote or photographed --
 * nothing here is a judgement about a person.
 *
 * Three rules they all follow:
 *
 *  1. **A mark needs a floor.** One careful comment is luck; the minimum
 *     evidence for each mark is written into its rule below. Under the floor
 *     the mark is simply absent -- never shown greyed out, because "you did
 *     not earn this" and "there was nothing to earn it with" are different
 *     things and a driver whose vans were all fine has done nothing wrong.
 *  2. **No mark is negative.** There is no icon for a rushed form or a missing
 *     photo. A board that shames people gets gamed, and the fastest way to
 *     earn a good time is to open the form and leave it lying on the seat.
 *  3. **Nothing here is a ranking.** The score decides the order; the marks
 *     just sit beside it.
 */

/**
 * Drawn, not copied, and drawn in one weight so the row reads evenly. Each is
 * a 24x24 box with `currentColor`, like the telltales -- the colour comes from
 * the class so the same drawing works on the board and in the admin table.
 */
const ICONS = {
  /* A speech bubble with two lines in it: they wrote something. */
  comments:
    '<path d="M4 5.5h16v11H9.5L5 20.5V16.5H4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M7.5 9.5h9M7.5 12.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',

  /* A clock whose hands sit at ten past -- the one arrangement nobody reads
     as "hurry up". */
  time:
    '<circle cx="12" cy="12.5" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M9.5 3.5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',

  /* A camera. The lens is a plain circle: at 18 px anything else is a smudge. */
  photo:
    '<path d="M3.5 8h4l1.5-2h6L16.5 8h4v11h-17z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.7"/>',

  /* A calendar with every square filled: the month with nothing missing. */
  streak:
    '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M7.5 13h2.2v2.2H7.5zM10.9 13h2.2v2.2h-2.2zM14.3 13h2.2v2.2h-2.2z" fill="currentColor"/>'
};

function icon(name, size = 18) {
  const d = ICONS[name];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${d}</svg>`;
}

/**
 * The four marks, with the rule in the four languages the drivers read.
 *
 * `short` is what a tooltip says; the board has no room for more, and the
 * long version lives on /admin/stats where somebody is reading rather than
 * standing in a yard.
 */
const BADGES = [
  {
    key: 'comments',
    sv: { name: 'Tydliga kommentarer', short: 'Skriver vad som är fel, inte bara att något är det.' },
    en: { name: 'Clear comments', short: 'Writes what is wrong, not just that something is.' },
    ar: { name: 'تعليقات واضحة', short: 'يكتب ما هو العطل، لا أن هناك عطلًا فقط.' },
    hi: { name: 'स्पष्ट टिप्पणियाँ', short: 'क्या ख़राबी है यह लिखते हैं, सिर्फ़ इतना नहीं कि कुछ ख़राब है।' }
  },
  {
    key: 'time',
    sv: { name: 'Tar sig tid', short: 'Lägger minst lika lång tid på kontrollen som de flesta.' },
    en: { name: 'Takes the time', short: 'Spends at least as long on the check as most people do.' },
    ar: { name: 'يأخذ وقته', short: 'يقضي على الفحص وقتًا لا يقل عن وقت الآخرين.' },
    hi: { name: 'समय लेते हैं', short: 'जाँच पर कम से कम उतना समय देते हैं जितना अधिकांश लोग।' }
  },
  {
    key: 'photo',
    sv: { name: 'Fotar skadan', short: 'Bifogar bild varje gång det finns något att visa.' },
    en: { name: 'Photographs the damage', short: 'Attaches a picture every time there is something to show.' },
    ar: { name: 'يصوّر الضرر', short: 'يرفق صورة في كل مرة يوجد ما يستحق العرض.' },
    hi: { name: 'नुकसान की फ़ोटो', short: 'जब भी दिखाने लायक कुछ हो, फ़ोटो लगाते हैं।' }
  },
  {
    key: 'streak',
    sv: { name: 'Missar aldrig', short: 'Har lämnat in varenda kontroll de blivit tilldelade.' },
    en: { name: 'Never misses', short: 'Has filed every single check they were assigned.' },
    ar: { name: 'لا يفوّت أبدًا', short: 'قدّم كل فحص أُسند إليه دون استثناء.' },
    hi: { name: 'कभी नहीं चूकते', short: 'हर सौंपी गई जाँच जमा की है।' }
  }
];

const BADGE_BY_KEY = Object.fromEntries(BADGES.map(b => [b.key, b]));

/** How much evidence a mark needs before it means anything. */
const FLOORS = {
  comments: 3,   // occasions where something was wrong and a comment was offered
  time: 3,       // checks whose duration could be measured at all
  photo: 2,      // occasions where a photo was called for
  streak: 5      // assignments -- the same floor the ranking uses
};

/** How good is good enough. Written here rather than inline, so it is arguable. */
const BAR = {
  commentRate: 0.8,   // said what was wrong four times out of five
  medianWords: 4      // and said it in more than a word or two
};

/**
 * Which marks this driver has earned.
 *
 * `fleetMedianFill` is the median of every measured check in the period; a
 * driver earns the clock by being at or above it. That is deliberately a
 * relative bar: what counts as unhurried depends on the form, the weather and
 * the van, and a fixed number of minutes would be wrong for all three. It also
 * means roughly half the fleet can hold it -- it marks the unhurried half, not
 * a podium.
 */
function badgesFor(row, fleetMedianFill) {
  const out = [];
  if (!row) return out;

  if (row.careBasis >= FLOORS.comments &&
      row.commentRate !== null && row.commentRate >= BAR.commentRate &&
      row.medianWords !== null && row.medianWords >= BAR.medianWords) {
    out.push('comments');
  }

  if (fleetMedianFill && row.fillCount >= FLOORS.time &&
      row.medianFill !== null && row.medianFill >= fleetMedianFill) {
    out.push('time');
  }

  if (row.photoChances >= FLOORS.photo && row.photoTaken === row.photoChances) {
    out.push('photo');
  }

  if (row.expected >= FLOORS.streak && row.done === row.expected) {
    out.push('streak');
  }

  return out;
}

/** A badge's wording in one language, falling back to Swedish. */
function badgeText(key, lang) {
  const b = BADGE_BY_KEY[key];
  if (!b) return { name: key, short: '' };
  return b[lang] || b.sv;
}

module.exports = { ICONS, icon, BADGES, BADGE_BY_KEY, badgesFor, badgeText, FLOORS, BAR };
