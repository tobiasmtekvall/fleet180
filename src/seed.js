'use strict';

/**
 * What a brand new database starts with. Once the app has run, everything
 * here lives in Postgres and is edited from /admin -- this file is only
 * the starting point, and is never re-applied to a database that already
 * has vehicles or forms in it.
 */

const FORM_KEY = 'jonkoping-sakerhetskontroll-b-bil';
const FORM_TITLE = '(Jönköping) Säkerhetskontroll B-bil';

const S1 = 'Del 1 av 4 – Förare och fordon';
const S2 = 'Del 2 av 4 – Belysning, däck, kaross, bakgavellyft';
const S3 = 'Del 3 av 4 – Vätskor och tankning';
const S4 = 'Del 4 av 4 – Instrumentpanel, hytt och övrigt';

/**
 * The original Fleet 360 questions, in order and word for word (typos
 * included -- drivers recognise the wording). Questions that ask for a
 * yes or a no are `yesno`, which on a phone is three buttons plus a
 * comment box, instead of a free-text field the driver has to type into.
 * Anything that wants a description or a number stays `text`.
 *
 * `name` is the key the answer is stored under and must never change for
 * an existing question -- f0..f15 keeps submissions made before the form
 * editor existed readable.
 */
const DEFAULT_FIELDS = [
  { name: 'f0',  kind: 'text',  section: S1, required: true,  role: 'driver',
    label: 'Namn och efternamn:' },
  { name: 'f1',  kind: 'text',  section: S1, required: true,  role: 'route',
    label: 'Din rutt:' },
  { name: 'f2',  kind: 'text',  section: S1, required: true,  role: 'odometer',
    label: 'Ange fordonets miltal:' },

  { name: 'f3',  kind: 'yesno', section: S2, required: true,
    label: 'Fungerar utvändig belysning som tex hel/halvjus, blinkers, bromsljus, sidopositions ljus? Om nej, beskriv vilken lampa som inte fungerar' },
  { name: 'f4',  kind: 'yesno', section: S2, required: true,
    label: 'Är däck i bra skick? Om nej, beskriv problemet och rapportera till närmsta ansvarig.' },
  { name: 'f5',  kind: 'yesno', section: S2, required: true,
    label: 'Finns det några nya yttre skador på kaross? Svara ja eller nej.' },
  { name: 'file0', kind: 'photo', section: S2, required: false,
    label: 'Om ja, ta ett foto på skadan/skadorna och rapportera till närmsta ansvarig.' },
  { name: 'f6',  kind: 'yesno', section: S2, required: true,
    label: 'Fungerar bakgavellyft som den ska? Om nej, beskriv problemet och rapportera till närmsta ansvarig.' },

  { name: 'f7',  kind: 'yesno', section: S3, required: true,
    label: 'Är vätskor kontrollerade tex, olja, glykol, spolarvätska? Svara ja eller nej.' },
  { name: 'f8',  kind: 'yesno', section: S3, required: true,
    label: 'Är bilen fulltankad (HVO)? Svara ja eller nej.' },
  { name: 'f9',  kind: 'text',  section: S3, required: true,
    label: 'Är fordonet tankat med ADBLUE (mer än 30%)? Svara i hur många procent det finns.' },

  { name: 'f10', kind: 'yesno', section: S4, required: true,
    label: 'Lyser det några kontroll lampor på instrumentpanelen? Svara ja eller nej.' },
  { name: 'file1', kind: 'photo', section: S4, required: false,
    label: 'Om ja, ta foto av varningssymbolen (om röd varningslampa kontakta närmsta ansvarig).' },
  { name: 'f11', kind: 'yesno', section: S4, required: true,
    label: 'Fungerar bältes lås som det ska? Svara ja eller nej.' },
  { name: 'f12', kind: 'yesno', section: S4, required: true,
    label: 'Är bilen städad? (inga lösa föremål i hytt). Svara ja eller nej.' },
  { name: 'f13', kind: 'yesno', section: S4, required: true,
    label: 'Fungerar vindrutetorkarna? Svara ja eller nej. Om nej, rapportera till närmast ansvarig.' },
  { name: 'f14', kind: 'yesno', section: S4, required: true,
    label: 'Fungerar backkameran om denna finns på fordonet? Svara ja eller nej.' },
  { name: 'f15', kind: 'yesno', section: S4, required: false,
    label: 'Har fordonet övriga brister? Sara ja eller nej. Om ja rapportera till närmsta ansvarig.' }
];

/**
 * The fleet as of 2026-09-08.
 *
 * Box vans follow the order in the suite's current priority matrix
 * (drivers/priority-matrix-2026-08-27.json), with BPM38R kept on Tobias's
 * instruction and ESJ01Y dropped -- that van is gone. Owner is 'own',
 * 'okq8' or '' , and '' means nobody has said, not "no owner": TTJ00A,
 * RAH84S and all six home vans are deliberately blank. The home fleet
 * comes from the licence-control picker.
 */
const DEFAULT_VEHICLES = [
  { plate: 'ODW03R', owner: 'okq8', fleet: 'box' },
  { plate: 'RBE87T', owner: 'okq8', fleet: 'box' },
  { plate: 'XWA50L', owner: 'okq8', fleet: 'box' },
  { plate: 'BPM38R', owner: 'okq8', fleet: 'box' },
  { plate: 'HJA34R', owner: 'okq8', fleet: 'box' },
  { plate: 'BBR00N', owner: 'okq8', fleet: 'box' },
  { plate: 'WAT90D', owner: 'okq8', fleet: 'box' },
  { plate: 'RBE26H', owner: 'own',  fleet: 'box' },
  { plate: 'RPH54L', owner: 'own',  fleet: 'box' },
  { plate: 'DHN13H', owner: 'own',  fleet: 'box' },
  { plate: 'GJR88K', owner: 'own',  fleet: 'box' },
  { plate: 'ODJ63H', owner: 'own',  fleet: 'box' },
  { plate: 'ELZ35L', owner: 'own',  fleet: 'box' },
  { plate: 'SSB55B', owner: 'own',  fleet: 'box' },
  { plate: 'TTJ00A', owner: '',     fleet: 'box' },
  { plate: 'RAH84S', owner: '',     fleet: 'box' },
  { plate: 'MER05W', owner: '',     fleet: 'home' },
  { plate: 'BZU92Z', owner: '',     fleet: 'home' },
  { plate: 'RLX94L', owner: '',     fleet: 'home' },
  { plate: 'CDK93M', owner: '',     fleet: 'home' },
  { plate: 'DTE97W', owner: '',     fleet: 'home' },
  { plate: 'WBH37M', owner: '',     fleet: 'home' }
];

module.exports = { FORM_KEY, FORM_TITLE, DEFAULT_FIELDS, DEFAULT_VEHICLES };
