'use strict';

/**
 * What a brand new database starts with. Once the app has run, everything
 * here lives in Postgres and is edited from /admin -- this file is only
 * the starting point, and is never re-applied to a database that already
 * has vehicles or forms in it.
 */

const FORM_KEY = 'jonkoping-sakerhetskontroll-b-bil';
const FORM_TITLE = '(Jönköping) Säkerhetskontroll B-bil';
const FORM_I18N = {
  en: { title: '(Jönköping) Safety check – van' },
  ar: { title: '(يونشوبينغ) فحص السلامة – مركبة فئة B' },
  hi: { title: '(Jönköping) सुरक्षा जाँच – वैन' }
};

const S1 = 'Del 1 av 5 – Förare och fordon';
const SR = 'Del 2 av 5 – Innan du lämnar bilen';
const S2 = 'Del 3 av 5 – Belysning, däck, kaross, bakgavellyft';
const S3 = 'Del 4 av 5 – Vätskor och tankning';
const S4 = 'Del 5 av 5 – Instrumentpanel, hytt och övrigt';

const SEC = {
  [S1]: { en: 'Part 1 of 5 – Driver and vehicle',
          ar: 'الجزء 1 من 5 – السائق والمركبة',
          hi: 'भाग 1/5 – चालक और वाहन' },
  [SR]: { en: 'Part 2 of 5 – Before you leave the vehicle',
          ar: 'الجزء 2 من 5 – قبل أن تترك المركبة',
          hi: 'भाग 2/5 – वाहन छोड़ने से पहले' },
  [S2]: { en: 'Part 3 of 5 – Lights, tyres, bodywork, tail lift',
          ar: 'الجزء 3 من 5 – الإضاءة، الإطارات، الهيكل، رافعة الباب الخلفي',
          hi: 'भाग 3/5 – लाइट, टायर, बॉडी, टेल लिफ्ट' },
  [S3]: { en: 'Part 4 of 5 – Fluids and fuelling',
          ar: 'الجزء 4 من 5 – السوائل والتزوّد بالوقود',
          hi: 'भाग 4/5 – तरल पदार्थ और ईंधन' },
  [S4]: { en: 'Part 5 of 5 – Dashboard, cab and other',
          ar: 'الجزء 5 من 5 – لوحة القيادة والمقصورة وأمور أخرى',
          hi: 'भाग 5/5 – डैशबोर्ड, केबिन और अन्य' }
};

/**
 * The section headings as they read before the return questions were added,
 * mapped to what they read now. The migration uses this to renumber a form
 * that is already in the database -- a heading saying "Del 2 av 4" above the
 * third of five cards is the kind of small wrongness drivers stop trusting.
 */
const SECTION_RENAMES = [
  { from: 'Del 1 av 4 – Förare och fordon', to: S1 },
  { from: 'Del 2 av 4 – Belysning, däck, kaross, bakgavellyft', to: S2 },
  { from: 'Del 3 av 4 – Vätskor och tankning', to: S3 },
  { from: 'Del 4 av 4 – Instrumentpanel, hytt och övrigt', to: S4 }
];

/** Helper: build the per-field i18n blob from label translations. */
function tr(section, en, ar, hi) {
  return {
    en: { label: en, section: SEC[section].en },
    ar: { label: ar, section: SEC[section].ar },
    hi: { label: hi, section: SEC[section].hi }
  };
}

/** Din rutt: JK-EM-1 … JK-EM-20. */
const ROUTES = Array.from({ length: 20 }, (_, i) => `JK-EM-${i + 1}`);

/** AdBlue: 100 % down to 30 % in steps of five. */
const ADBLUE = Array.from({ length: 15 }, (_, i) => `${100 - i * 5}%`);

/**
 * The original Fleet 360 questions, in order and word for word (typos
 * included -- drivers recognise the wording). Questions that ask for a
 * yes or a no are `yesno`, which on a phone is three buttons plus a
 * comment box. Three are dropdowns: the driver's name (filled from the
 * roster the Route Suite syncs), the route, and the AdBlue percentage.
 *
 * `alertOn` lists the answers that mean something needs attention -- it
 * is per question because the polarity differs: "does it work" is a
 * problem on Nej, "is there new damage" is a problem on Ja. Those are
 * what the daily mail and the extension's day view highlight.
 *
 * `name` is the key the answer is stored under and must never change for
 * an existing question -- f0..f15 keeps submissions made before the form
 * editor existed readable.
 */
const DEFAULT_FIELDS = [
  { name: 'f0', kind: 'select', section: S1, required: true, role: 'driver',
    source: 'drivers',
    label: 'Namn och efternamn:',
    i18n: tr(S1, 'First and last name:', 'الاسم واسم العائلة:', 'नाम और उपनाम:') },

  { name: 'f1', kind: 'select', section: S1, required: true, role: 'route',
    options: ROUTES,
    label: 'Din rutt:',
    i18n: tr(S1, 'Your route:', 'مسارك:', 'आपका रूट:') },

  { name: 'f2', kind: 'text', section: S1, required: true, role: 'odometer',
    label: 'Ange fordonets miltal:',
    i18n: tr(S1, "Enter the vehicle's odometer (mil):",
             'أدخل عدّاد المسافة للمركبة (ميل سويدي):',
             'वाहन का ओडोमीटर दर्ज करें (स्वीडिश मील):') },

  /* Asked when the driver hands the vehicle back, which is why they sit
     directly after the name and route rather than at the end: a driver who
     has already answered sixteen questions is not reading the seventeenth.
     The polarity differs per question -- forgetting to switch something off
     is a problem on Nej, taking equipment or causing damage on Ja. */
  { name: 'r1', kind: 'yesno', section: SR, required: true, alertOn: ['nej', 'annat'],
    label: 'Har du stängt av bakgavellyftens strömbrytare och lastutrymmets belysning (när det är aktuellt)?',
    i18n: tr(SR,
      'Have you turned off the tail lift switch and the cargo lights (when applicable)?',
      'هل أطفأت مفتاح الرافعة الخلفية وأضواء صندوق الشحن (عند الحاجة)؟',
      'क्या आपने टेल लिफ्ट का स्विच और कार्गो लाइटें बंद कर दी हैं (जहाँ लागू हो)?') },

  { name: 'r2', kind: 'yesno', section: SR, required: true, alertOn: ['ja', 'annat'],
    label: 'Har du tagit någon laddkabel, mobilhållare eller spännband från den här bilen?',
    i18n: tr(SR,
      'Have you taken any charging cable, phone holder or ratchet strap from this vehicle?',
      'هل أخذت أي كابل شحن أو حامل هاتف أو حزام ربط من هذه المركبة؟',
      'क्या आपने इस वाहन से कोई चार्जिंग केबल, फ़ोन होल्डर या रैचेट स्ट्रैप लिया है?') },

  { name: 'r3', kind: 'yesno', section: SR, required: true, alertOn: ['ja', 'annat'],
    label: 'Har du orsakat NÅGON skada på den här bilen i dag?',
    i18n: tr(SR,
      'Have you caused ANY damage to this vehicle today?',
      'هل تسببت في أي ضرر لهذه المركبة اليوم؟',
      'क्या आपने आज इस वाहन को कोई भी नुकसान पहुँचाया है?') },

  { name: 'f3', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar utvändig belysning som tex hel/halvjus, blinkers, bromsljus, sidopositions ljus? Om nej, beskriv vilken lampa som inte fungerar',
    i18n: tr(S2,
      'Does the exterior lighting work – main/dipped beam, indicators, brake lights, side marker lights? If no, describe which lamp is not working',
      'هل تعمل الإضاءة الخارجية مثل الضوء العالي/المنخفض وإشارات الانعطاف وأضواء الفرامل والأضواء الجانبية؟ إذا كانت الإجابة لا، صف المصباح الذي لا يعمل',
      'क्या बाहरी लाइटें काम कर रही हैं – हाई/लो बीम, इंडिकेटर, ब्रेक लाइट, साइड लाइट? यदि नहीं, तो बताएं कौन सी लाइट काम नहीं कर रही') },

  { name: 'f4', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    label: 'Är däck i bra skick? Om nej, beskriv problemet och rapportera till närmsta ansvarig.',
    i18n: tr(S2,
      'Are the tyres in good condition? If no, describe the problem and report it to your nearest supervisor.',
      'هل الإطارات بحالة جيدة؟ إذا كانت الإجابة لا، صف المشكلة وأبلغ المسؤول المباشر.',
      'क्या टायर अच्छी हालत में हैं? यदि नहीं, तो समस्या बताएं और अपने निकटतम प्रभारी को सूचित करें।') },

  { name: 'f5', kind: 'yesno', section: S2, required: true, alertOn: ['ja', 'annat'],
    label: 'Finns det några nya yttre skador på kaross? Svara ja eller nej.',
    i18n: tr(S2,
      'Is there any new external damage to the bodywork? Answer yes or no.',
      'هل توجد أضرار خارجية جديدة في الهيكل؟ أجب بنعم أو لا.',
      'क्या बॉडी पर कोई नया बाहरी नुकसान है? हाँ या नहीं में उत्तर दें।') },

  { name: 'file0', kind: 'photo', section: S2, required: false,
    label: 'Om ja, ta ett foto på skadan/skadorna och rapportera till närmsta ansvarig.',
    i18n: tr(S2,
      'If yes, take a photo of the damage and report it to your nearest supervisor.',
      'إذا كانت الإجابة نعم، التقط صورة للضرر وأبلغ المسؤول المباشر.',
      'यदि हाँ, तो नुकसान की फोटो लें और अपने निकटतम प्रभारी को सूचित करें।') },

  { name: 'f6', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar bakgavellyft som den ska? Om nej, beskriv problemet och rapportera till närmsta ansvarig.',
    i18n: tr(S2,
      'Does the tail lift work as it should? If no, describe the problem and report it to your nearest supervisor.',
      'هل تعمل الرافعة الخلفية كما ينبغي؟ إذا كانت الإجابة لا، صف المشكلة وأبلغ المسؤول المباشر.',
      'क्या टेल लिफ्ट ठीक से काम कर रही है? यदि नहीं, तो समस्या बताएं और सूचित करें।') },

  { name: 'f7', kind: 'yesno', section: S3, required: true, alertOn: ['nej', 'annat'],
    label: 'Är vätskor kontrollerade tex, olja, glykol, spolarvätska? Svara ja eller nej.',
    i18n: tr(S3,
      'Have the fluids been checked – oil, coolant, washer fluid? Answer yes or no.',
      'هل تم فحص السوائل مثل الزيت وسائل التبريد وسائل غسل الزجاج؟ أجب بنعم أو لا.',
      'क्या तरल पदार्थ जाँचे गए हैं – तेल, कूलेंट, वॉशर द्रव? हाँ या नहीं में उत्तर दें।') },

  { name: 'f8', kind: 'yesno', section: S3, required: true, alertOn: ['nej', 'annat'],
    label: 'Är bilen fulltankad (HVO)? Svara ja eller nej.',
    i18n: tr(S3,
      'Is the vehicle fully fuelled (HVO)? Answer yes or no.',
      'هل المركبة ممتلئة بالوقود (HVO)؟ أجب بنعم أو لا.',
      'क्या वाहन पूरी तरह ईंधन से भरा है (HVO)? हाँ या नहीं में उत्तर दें।') },

  { name: 'f9', kind: 'select', section: S3, required: true, options: ADBLUE,
    label: 'Är fordonet tankat med ADBLUE (mer än 30%)? Svara i hur många procent det finns.',
    i18n: tr(S3,
      'Is the vehicle filled with AdBlue (more than 30%)? State the percentage remaining.',
      'هل المركبة مزوّدة بـ AdBlue (أكثر من 30%)؟ حدّد النسبة المتبقية.',
      'क्या वाहन में AdBlue भरा है (30% से अधिक)? शेष प्रतिशत बताएं।') },

  { name: 'f10', kind: 'yesno', section: S4, required: true, alertOn: ['ja', 'annat'],
    label: 'Lyser det några kontroll lampor på instrumentpanelen? Svara ja eller nej.',
    i18n: tr(S4,
      'Are any warning lights lit on the dashboard? Answer yes or no.',
      'هل تضيء أي لمبات تحذير على لوحة القيادة؟ أجب بنعم أو لا.',
      'क्या डैशबोर्ड पर कोई चेतावनी लाइट जल रही है? हाँ या नहीं में उत्तर दें।') },

  { name: 'file1', kind: 'photo', section: S4, required: false,
    label: 'Om ja, ta foto av varningssymbolen (om röd varningslampa kontakta närmsta ansvarig).',
    i18n: tr(S4,
      'If yes, photograph the warning symbol (if it is a red warning light, contact your nearest supervisor).',
      'إذا كانت الإجابة نعم، صوّر رمز التحذير (إذا كان الضوء أحمر، اتصل بالمسؤول المباشر).',
      'यदि हाँ, तो चेतावनी चिह्न की फोटो लें (लाल चेतावनी लाइट होने पर प्रभारी से संपर्क करें)।') },

  { name: 'f11', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar bältes lås som det ska? Svara ja eller nej.',
    i18n: tr(S4,
      'Does the seat belt buckle work as it should? Answer yes or no.',
      'هل يعمل قفل حزام الأمان كما ينبغي؟ أجب بنعم أو لا.',
      'क्या सीट बेल्ट का बकल ठीक से काम कर रहा है? हाँ या नहीं में उत्तर दें।') },

  { name: 'f12', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Är bilen städad? (inga lösa föremål i hytt). Svara ja eller nej.',
    i18n: tr(S4,
      'Is the cab clean? (no loose objects in the cab). Answer yes or no.',
      'هل المقصورة نظيفة؟ (لا توجد أغراض سائبة في المقصورة). أجب بنعم أو لا.',
      'क्या केबिन साफ़ है? (केबिन में कोई ढीली वस्तु नहीं)। हाँ या नहीं में उत्तर दें।') },

  { name: 'f13', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar vindrutetorkarna? Svara ja eller nej. Om nej, rapportera till närmast ansvarig.',
    i18n: tr(S4,
      'Do the windscreen wipers work? Answer yes or no. If no, report it to your nearest supervisor.',
      'هل تعمل مسّاحات الزجاج الأمامي؟ أجب بنعم أو لا. إذا كانت الإجابة لا، أبلغ المسؤول المباشر.',
      'क्या विंडस्क्रीन वाइपर काम कर रहे हैं? हाँ या नहीं। यदि नहीं, तो सूचित करें।') },

  { name: 'f14', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar backkameran om denna finns på fordonet? Svara ja eller nej.',
    i18n: tr(S4,
      'Does the reversing camera work, if the vehicle has one? Answer yes or no.',
      'هل تعمل كاميرا الرجوع إن وُجدت في المركبة؟ أجب بنعم أو لا.',
      'क्या रिवर्स कैमरा काम कर रहा है, यदि वाहन में है? हाँ या नहीं में उत्तर दें।') },

  { name: 'f15', kind: 'yesno', section: S4, required: false, alertOn: ['ja', 'annat'],
    label: 'Har fordonet övriga brister? Sara ja eller nej. Om ja rapportera till närmsta ansvarig.',
    i18n: tr(S4,
      'Does the vehicle have any other faults? Answer yes or no. If yes, report it to your nearest supervisor.',
      'هل توجد أعطال أخرى في المركبة؟ أجب بنعم أو لا. إذا كانت الإجابة نعم، أبلغ المسؤول المباشر.',
      'क्या वाहन में कोई अन्य खराबी है? हाँ या नहीं। यदि हाँ, तो सूचित करें।') }
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

/** Every language's text for one section heading. */
function SECTION_TEXT(section) {
  return SEC[section] || {};
}

/** The questions added on 2026-09-09, for the migration to place. */
const RETURN_FIELDS = DEFAULT_FIELDS.filter(f => f.section === SR);

module.exports = {
  FORM_KEY, FORM_TITLE, FORM_I18N, DEFAULT_FIELDS, DEFAULT_VEHICLES, ROUTES, ADBLUE,
  SECTION_RENAMES, RETURN_FIELDS, SECTION_RETURN: SR, SECTION_TEXT
};
