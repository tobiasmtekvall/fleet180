'use strict';

/**
 * The form, copied field for field from the Fleet 360 original
 * "(Jonkoping) Sakerhetskontroll B-bil". Question wording, order,
 * required/optional status and the two camera fields are unchanged --
 * including the original's own typos ("Sara ja eller nej"), because
 * drivers recognise the paper wording.
 *
 * Every OKQ8 vehicle gets its own copy of this at /v/<PLATE>.
 */

const FORM_KEY = 'jonkoping-sakerhetskontroll-b-bil';
const FORM_TITLE = '(Jönköping) Säkerhetskontroll B-bil';

const SECTIONS = [
  {
    id: 'sec1',
    num: 1,
    rail: 'Namn och efternamn',
    tag: 'Del 1 av 4 – Förare och fordon',
    fields: [
      { kind: 'text', name: 'f0', column: 'driver_name',
        label: 'Namn och efternamn:', required: true, autocomplete: 'name' },
      { kind: 'text', name: 'f1', column: 'route',
        label: 'Din rutt:', required: true },
      { kind: 'text', name: 'f2', column: 'odometer',
        label: 'Ange fordonets miltal:', required: true, inputmode: 'numeric' }
    ]
  },
  {
    id: 'sec2',
    num: 2,
    rail: 'Belysning, däck, kaross, bakgavellyft',
    tag: 'Del 2 av 4 – Belysning, däck, kaross, bakgavellyft',
    fields: [
      { kind: 'text', name: 'f3', required: true,
        label: 'Fungerar utvändig belysning som tex hel/halvjus, blinkers, bromsljus, sidopositions ljus? Om nej, beskriv vilken lampa som inte fungerar' },
      { kind: 'text', name: 'f4', required: true,
        label: 'Är däck i bra skick? Om nej, beskriv problemet och rapportera till närmsta ansvarig.' },
      { kind: 'text', name: 'f5', required: true,
        label: 'Finns det några nya yttre skador på kaross? Svara ja eller nej.' },
      { kind: 'file', name: 'file0',
        label: 'Om ja, ta ett foto på skadan/skadorna och rapportera till närmsta ansvarig.' },
      { kind: 'text', name: 'f6', required: true,
        label: 'Fungerar bakgavellyft som den ska? Om nej, beskriv problemet och rapportera till närmsta ansvarig.' }
    ]
  },
  {
    id: 'sec3',
    num: 3,
    rail: 'Vätskor, HVO, AdBlue',
    tag: 'Del 3 av 4 – Vätskor och tankning',
    fields: [
      { kind: 'text', name: 'f7', required: true,
        label: 'Är vätskor kontrollerade tex, olja, glykol, spolarvätska? Svara ja eller nej.' },
      { kind: 'text', name: 'f8', required: true,
        label: 'Är bilen fulltankad (HVO)? Svara ja eller nej.' },
      { kind: 'text', name: 'f9', required: true,
        label: 'Är fordonet tankat med ADBLUE (mer än 30%)? Svara i hur många procent det finns.' }
    ]
  },
  {
    id: 'sec4',
    num: 4,
    rail: 'Instrumentpanel, hytt & övrigt',
    tag: 'Del 4 av 4 – Instrumentpanel, hytt och övrigt',
    fields: [
      { kind: 'text', name: 'f10', required: true,
        label: 'Lyser det några kontroll lampor på instrumentpanelen? Svara ja eller nej.' },
      { kind: 'file', name: 'file1',
        label: 'Om ja, ta foto av varningssymbolen (om röd varningslampa kontakta närmsta ansvarig).' },
      { kind: 'text', name: 'f11', required: true,
        label: 'Fungerar bältes lås som det ska? Svara ja eller nej.' },
      { kind: 'text', name: 'f12', required: true,
        label: 'Är bilen städad? (inga lösa föremål i hytt). Svara ja eller nej.' },
      { kind: 'text', name: 'f13', required: true,
        label: 'Fungerar vindrutetorkarna? Svara ja eller nej. Om nej, rapportera till närmast ansvarig.' },
      { kind: 'text', name: 'f14', required: true,
        label: 'Fungerar backkameran om denna finns på fordonet? Svara ja eller nej.' },
      { kind: 'text', name: 'f15', required: false,
        label: 'Har fordonet övriga brister? Sara ja eller nej. Om ja rapportera till närmsta ansvarig.' }
    ]
  }
];

/** Flat list of every field, in page order. */
const FIELDS = SECTIONS.flatMap(s => s.fields);
const TEXT_FIELDS = FIELDS.filter(f => f.kind === 'text');
const FILE_FIELDS = FIELDS.filter(f => f.kind === 'file');

/** name -> field, for validating and for labelling a stored answer later. */
const FIELD_BY_NAME = new Map(FIELDS.map(f => [f.name, f]));

module.exports = {
  FORM_KEY, FORM_TITLE, SECTIONS,
  FIELDS, TEXT_FIELDS, FILE_FIELDS, FIELD_BY_NAME
};
