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

/**
 * Which lamp is not working -- offered when the exterior-lighting question is
 * answered Nej.
 *
 * The value that is stored is the Swedish one whatever language the driver
 * read it in, so a month of checks has one spelling per lamp and the workshop
 * can count them. "Annat" is last and leaves the free-text box to say what.
 */
const LAMPS = [
  'Helljus',
  'Halvljus',
  'Blinkers fram',
  'Blinkers bak',
  'Bromsljus',
  'Backljus',
  'Positions-/sidomarkeringsljus',
  'Skyltbelysning',
  'Annat'
];

const LAMPS_I18N = {
  en: ['Main beam', 'Dipped beam', 'Front indicators', 'Rear indicators',
       'Brake lights', 'Reversing lights', 'Side/marker lights',
       'Number plate light', 'Other'],
  ar: ['الضوء العالي', 'الضوء المنخفض', 'إشارات الانعطاف الأمامية',
       'إشارات الانعطاف الخلفية', 'أضواء الفرامل', 'أضواء الرجوع للخلف',
       'الأضواء الجانبية', 'إضاءة لوحة الأرقام', 'أخرى'],
  hi: ['हाई बीम', 'लो बीम', 'आगे के इंडिकेटर', 'पीछे के इंडिकेटर',
       'ब्रेक लाइट', 'रिवर्स लाइट', 'साइड/मार्कर लाइट',
       'नंबर प्लेट लाइट', 'अन्य'],
  q: { sv: 'Vilken lampa fungerar inte?', en: 'Which lamp is not working?',
       ar: 'أي مصباح لا يعمل؟', hi: 'कौन सी लाइट काम नहीं कर रही?' }
};

/** The i18n blob for a question, with its follow-up list translated too. */
function trLamps(section, en, ar, hi) {
  return withList(tr(section, en, ar, hi), LAMPS_I18N);
}

/**
 * Add a follow-up list's translations to a question's i18n blob.
 *
 * The Swedish wording IS the stored value, so it is not repeated here; the
 * three translations are matched to it by position. A list and its
 * translations must therefore stay the same length and the same order — the
 * form editor shows them side by side for exactly that reason.
 *
 * `L.q` is the little question above the list. It is per question rather than
 * one phrase for all of them, because "Which one is not working?" above a list
 * of places on the bodywork is the kind of sentence a driver reads twice and
 * then answers wrongly. Swedish is carried too: the blob has no Swedish half
 * for labels (the label IS Swedish), but this one sentence has nowhere else
 * to live.
 */
function withList(blob, L) {
  const out = { ...blob };
  for (const c of ['en', 'ar', 'hi']) {
    out[c] = { ...out[c], commentOptions: L[c] };
  }
  if (L.q) {
    for (const c of ['sv', 'en', 'ar', 'hi']) {
      out[c] = { ...out[c], pickLabel: L.q[c] };
    }
  }
  return out;
}

/* ---- the follow-up lists -------------------------------------------------
 *
 * One per question that can be answered with "what exactly". They are the
 * everyday answers, in the order they are usually true, with "Annat" last so
 * anything unforeseen still has a home in the comment box beside it.
 */

const WHEELS = {
  sv: ['Vänster fram', 'Höger fram', 'Vänster bak', 'Höger bak', 'Reservhjul', 'Flera däck', 'Annat'],
  en: ['Left front', 'Right front', 'Left rear', 'Right rear', 'Spare wheel', 'Several tyres', 'Other'],
  ar: ['أمامي أيسر', 'أمامي أيمن', 'خلفي أيسر', 'خلفي أيمن', 'الإطار الاحتياطي', 'أكثر من إطار', 'أخرى'],
  hi: ['बायाँ अगला', 'दायाँ अगला', 'बायाँ पिछला', 'दायाँ पिछला', 'स्टेपनी', 'एक से अधिक टायर', 'अन्य'],
  q: { sv: 'Vilket däck?', en: 'Which tyre?',
       ar: 'أي إطار؟', hi: 'कौन सा टायर?' }
};

const BODY = {
  sv: ['Front / stötfångare', 'Bakdörrar', 'Höger sida', 'Vänster sida', 'Tak',
       'Lastutrymme / skåp', 'Bakgavellyft', 'Backspegel', 'Vindruta eller annan ruta',
       'Fälg eller däck', 'Annat'],
  en: ['Front / bumper', 'Rear doors', 'Right side', 'Left side', 'Roof',
       'Load area / box', 'Tail lift', 'Mirror', 'Windscreen or other glass',
       'Wheel rim or tyre', 'Other'],
  ar: ['الأمام / المصد', 'الأبواب الخلفية', 'الجانب الأيمن', 'الجانب الأيسر', 'السقف',
       'صندوق الشحن', 'الرافعة الخلفية', 'المرآة', 'الزجاج الأمامي أو زجاج آخر',
       'الجنط أو الإطار', 'أخرى'],
  hi: ['आगे / बंपर', 'पीछे के दरवाज़े', 'दायाँ हिस्सा', 'बायाँ हिस्सा', 'छत',
       'लोड एरिया / बॉक्स', 'टेल लिफ़्ट', 'शीशा (मिरर)', 'विंडस्क्रीन या अन्य काँच',
       'रिम या टायर', 'अन्य'],
  q: { sv: 'Var på bilen?', en: 'Where on the vehicle?',
       ar: 'أين في المركبة؟', hi: 'वाहन पर कहाँ?' }
};

const TAILLIFT = {
  sv: ['Går inte ner', 'Går inte upp', 'Läcker olja', 'Plattan är skadad',
       'Manöverdon eller fjärrkontroll trasig', 'Låser inte i körläge', 'Larmar eller låter konstigt', 'Annat'],
  en: ['Will not go down', 'Will not go up', 'Leaking oil', 'Platform damaged',
       'Control or remote broken', 'Does not lock for driving', 'Alarms or sounds wrong', 'Other'],
  ar: ['لا تنزل', 'لا ترتفع', 'تسريب زيت', 'المنصة تالفة',
       'وحدة التحكم أو الريموت معطلة', 'لا تُقفل لوضع السير', 'تصدر إنذارًا أو صوتًا غريبًا', 'أخرى'],
  hi: ['नीचे नहीं जाती', 'ऊपर नहीं जाती', 'तेल रिस रहा है', 'प्लेटफ़ॉर्म क्षतिग्रस्त',
       'कंट्रोल या रिमोट ख़राब', 'चलाने के लिए लॉक नहीं होती', 'अलार्म या अजीब आवाज़', 'अन्य'],
  q: { sv: 'Vad är felet?', en: 'What is wrong?',
       ar: 'ما العطل؟', hi: 'क्या ख़राबी है?' }
};

const FLUIDS = {
  sv: ['Motorolja', 'Kylarvätska / glykol', 'Spolarvätska', 'Bromsvätska', 'AdBlue',
       'Flera vätskor', 'Hann inte kontrollera', 'Annat'],
  en: ['Engine oil', 'Coolant', 'Washer fluid', 'Brake fluid', 'AdBlue',
       'Several fluids', 'No time to check', 'Other'],
  ar: ['زيت المحرك', 'سائل التبريد', 'سائل غسل الزجاج', 'سائل الفرامل', 'AdBlue',
       'أكثر من سائل', 'لم يتوفر وقت للفحص', 'أخرى'],
  hi: ['इंजन ऑयल', 'कूलेंट', 'वॉशर फ़्लूइड', 'ब्रेक फ़्लूइड', 'AdBlue',
       'एक से अधिक फ़्लूइड', 'जाँचने का समय नहीं मिला', 'अन्य'],
  q: { sv: 'Vilken vätska?', en: 'Which fluid?',
       ar: 'أي سائل؟', hi: 'कौन सा फ़्लूइड?' }
};

const FUELLING = {
  sv: ['Hann inte tanka', 'Tankkortet fungerade inte', 'Stationen var stängd eller tom',
       'Nästa förare tankar', 'Annat'],
  en: ['No time to refuel', 'The fuel card did not work', 'The station was closed or dry',
       'The next driver will refuel', 'Other'],
  ar: ['لم يتوفر وقت للتزود بالوقود', 'بطاقة الوقود لم تعمل', 'المحطة مغلقة أو فارغة',
       'السائق التالي سيتزود بالوقود', 'أخرى'],
  hi: ['ईंधन भरने का समय नहीं मिला', 'फ़्यूल कार्ड नहीं चला', 'स्टेशन बंद या ख़ाली था',
       'अगला ड्राइवर भरेगा', 'अन्य'],
  q: { sv: 'Varför inte?', en: 'Why not?',
       ar: 'ما السبب؟', hi: 'कारण क्या है?' }
};

const BELTS = {
  sv: ['Förarsidan', 'Passagerarsidan', 'Mittplatsen', 'Flera bälten', 'Annat'],
  en: ['Driver side', 'Passenger side', 'Middle seat', 'Several belts', 'Other'],
  ar: ['جهة السائق', 'جهة الراكب', 'المقعد الأوسط', 'أكثر من حزام', 'أخرى'],
  hi: ['ड्राइवर साइड', 'पैसेंजर साइड', 'बीच की सीट', 'एक से अधिक बेल्ट', 'अन्य'],
  q: { sv: 'Vilket bälte?', en: 'Which belt?',
       ar: 'أي حزام؟', hi: 'कौन सी बेल्ट?' }
};

const CLEAN = {
  sv: ['Skräp i hytten', 'Lösa föremål i hytten', 'Skräp i lastutrymmet',
       'Smutsiga rutor eller speglar', 'Hann inte städa', 'Annat'],
  en: ['Rubbish in the cab', 'Loose items in the cab', 'Rubbish in the load area',
       'Dirty windows or mirrors', 'No time to clean', 'Other'],
  ar: ['نفايات في المقصورة', 'أغراض غير مثبّتة في المقصورة', 'نفايات في صندوق الشحن',
       'زجاج أو مرايا متسخة', 'لم يتوفر وقت للتنظيف', 'أخرى'],
  hi: ['केबिन में कचरा', 'केबिन में खुली चीज़ें', 'लोड एरिया में कचरा',
       'गंदे शीशे या मिरर', 'सफ़ाई का समय नहीं मिला', 'अन्य'],
  q: { sv: 'Vad är kvar att göra?', en: 'What is left to do?',
       ar: 'ما الذي تبقّى؟', hi: 'क्या करना बाक़ी है?' }
};

const WIPERS = {
  sv: ['Torkarbladen är slitna', 'Torkarna går inte att slå på', 'Spolningen fungerar inte',
       'Spolarvätskan är slut', 'Intervalläget fungerar inte', 'Bakrutetorkaren', 'Annat'],
  en: ['Wiper blades worn', 'Wipers will not switch on', 'Washer does not work',
       'Washer fluid empty', 'Intermittent setting does not work', 'Rear wiper', 'Other'],
  ar: ['شفرات المساحات تالفة', 'المساحات لا تعمل', 'رشاش الماء لا يعمل',
       'سائل الغسل فارغ', 'وضع التقطيع لا يعمل', 'مساحة الزجاج الخلفي', 'أخرى'],
  hi: ['वाइपर ब्लेड घिसे', 'वाइपर चालू नहीं होते', 'वॉशर काम नहीं करता',
       'वॉशर फ़्लूइड ख़त्म', 'इंटरवल मोड काम नहीं करता', 'पिछला वाइपर', 'अन्य'],
  q: { sv: 'Vad är felet?', en: 'What is wrong?',
       ar: 'ما العطل؟', hi: 'क्या ख़राबी है?' }
};

const CAMERA = {
  sv: ['Svart bild', 'Suddig eller smutsig bild', 'Fungerar ibland', 'Skärmen är trasig',
       'Bilen har ingen backkamera', 'Annat'],
  en: ['Black picture', 'Blurred or dirty picture', 'Works sometimes', 'The screen is broken',
       'This van has no reversing camera', 'Other'],
  ar: ['صورة سوداء', 'صورة ضبابية أو متسخة', 'تعمل أحيانًا', 'الشاشة معطلة',
       'هذه المركبة بلا كاميرا خلفية', 'أخرى'],
  hi: ['काली स्क्रीन', 'धुंधली या गंदी तस्वीर', 'कभी-कभी चलता है', 'स्क्रीन टूटी है',
       'इस वैन में रिवर्स कैमरा नहीं है', 'अन्य'],
  q: { sv: 'Vad är felet?', en: 'What is wrong?',
       ar: 'ما العطل؟', hi: 'क्या ख़राबी है?' }
};

const LEFT_ON = {
  sv: ['Bakgavellyftens strömbrytare', 'Lastutrymmets belysning', 'Båda', 'Annat'],
  en: ['The tail lift switch', 'The cargo lights', 'Both', 'Other'],
  ar: ['مفتاح الرافعة الخلفية', 'إضاءة صندوق الشحن', 'كلاهما', 'أخرى'],
  hi: ['टेल लिफ़्ट स्विच', 'कार्गो लाइटें', 'दोनों', 'अन्य'],
  q: { sv: 'Vad är kvar påslaget?', en: 'What is still switched on?',
       ar: 'ما الذي بقي مشغّلًا؟', hi: 'क्या अब भी चालू है?' }
};

const TAKEN = {
  sv: ['Laddkabel', 'Mobilhållare', 'Spännband', 'Flera saker', 'Annat'],
  en: ['Charging cable', 'Phone holder', 'Ratchet strap', 'Several things', 'Other'],
  ar: ['كابل شحن', 'حامل هاتف', 'حزام ربط', 'أكثر من شيء', 'أخرى'],
  hi: ['चार्जिंग केबल', 'फ़ोन होल्डर', 'रैचेट स्ट्रैप', 'एक से अधिक चीज़ें', 'अन्य'],
  q: { sv: 'Vad tog du?', en: 'What did you take?',
       ar: 'ماذا أخذت؟', hi: 'आपने क्या लिया?' }
};

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
    label: 'Ange mätarställning i km:',
    i18n: tr(S1, "Enter the odometer reading (km):",
             'أدخل قراءة عدّاد المسافة (كم):',
             'ओडोमीटर रीडिंग दर्ज करें (किमी):') },

  /* Asked when the driver hands the vehicle back, which is why they sit
     directly after the name and route rather than at the end: a driver who
     has already answered sixteen questions is not reading the seventeenth.
     The polarity differs per question -- forgetting to switch something off
     is a problem on Nej, taking equipment or causing damage on Ja. */
  { name: 'r1', kind: 'yesno', section: SR, required: true, alertOn: ['nej', 'annat'],
    label: 'Har du stängt av bakgavellyftens strömbrytare och lastutrymmets belysning (när det är aktuellt)?',
    commentOptions: LEFT_ON.sv,
    i18n: withList(tr(SR,
      'Have you turned off the tail lift switch and the cargo lights (when applicable)?',
      'هل أطفأت مفتاح الرافعة الخلفية وأضواء صندوق الشحن (عند الحاجة)؟',
      'क्या आपने टेल लिफ्ट का स्विच और कार्गो लाइटें बंद कर दी हैं (जहाँ लागू हो)?'), LEFT_ON) },

  { name: 'r2', kind: 'yesno', section: SR, required: true, alertOn: ['ja', 'annat'],
    label: 'Har du tagit någon laddkabel, mobilhållare eller spännband från den här bilen?',
    commentOptions: TAKEN.sv,
    i18n: withList(tr(SR,
      'Have you taken any charging cable, phone holder or ratchet strap from this vehicle?',
      'هل أخذت أي كابل شحن أو حامل هاتف أو حزام ربط من هذه المركبة؟',
      'क्या आपने इस वाहन से कोई चार्जिंग केबल, फ़ोन होल्डर या रैचेट स्ट्रैप लिया है?'), TAKEN) },

  { name: 'r3', kind: 'yesno', section: SR, required: true, alertOn: ['ja', 'annat'],
    label: 'Har du orsakat NÅGON skada på den här bilen i dag?',
    commentOptions: BODY.sv,
    i18n: withList(tr(SR,
      'Have you caused ANY damage to this vehicle today?',
      'هل تسببت في أي ضرر لهذه المركبة اليوم؟',
      'क्या आपने आज इस वाहन को कोई भी नुकसान पहुँचाया है?'), BODY) },

  { name: 'f3', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    commentOptions: LAMPS,
    label: 'Fungerar utvändig belysning som tex hel/halvjus, blinkers, bromsljus, sidopositions ljus? Om nej, beskriv vilken lampa som inte fungerar',
    i18n: trLamps(S2,
      'Does the exterior lighting work – main/dipped beam, indicators, brake lights, side marker lights? If no, describe which lamp is not working',
      'هل تعمل الإضاءة الخارجية مثل الضوء العالي/المنخفض وإشارات الانعطاف وأضواء الفرامل والأضواء الجانبية؟ إذا كانت الإجابة لا، صف المصباح الذي لا يعمل',
      'क्या बाहरी लाइटें काम कर रही हैं – हाई/लो बीम, इंडिकेटर, ब्रेक लाइट, साइड लाइट? यदि नहीं, तो बताएं कौन सी लाइट काम नहीं कर रही') },

  { name: 'f4', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    label: 'Är däck i bra skick? Om nej, beskriv problemet och rapportera till närmsta ansvarig.',
    commentOptions: WHEELS.sv,
    i18n: withList(tr(S2,
      'Are the tyres in good condition? If no, describe the problem and report it to your nearest supervisor.',
      'هل الإطارات بحالة جيدة؟ إذا كانت الإجابة لا، صف المشكلة وأبلغ المسؤول المباشر.',
      'क्या टायर अच्छी हालत में हैं? यदि नहीं, तो समस्या बताएं और अपने निकटतम प्रभारी को सूचित करें।'), WHEELS) },

  { name: 'f5', kind: 'yesno', section: S2, required: true, alertOn: ['ja', 'annat'],
    label: 'Finns det några nya yttre skador på kaross? Svara ja eller nej.',
    commentOptions: BODY.sv,
    i18n: withList(tr(S2,
      'Is there any new external damage to the bodywork? Answer yes or no.',
      'هل توجد أضرار خارجية جديدة في الهيكل؟ أجب بنعم أو لا.',
      'क्या बॉडी पर कोई नया बाहरी नुकसान है? हाँ या नहीं में उत्तर दें।'), BODY) },

  { name: 'file0', kind: 'photo', section: S2, required: false,
    label: 'Om ja, ta ett foto på skadan/skadorna och rapportera till närmsta ansvarig.',
    i18n: tr(S2,
      'If yes, take a photo of the damage and report it to your nearest supervisor.',
      'إذا كانت الإجابة نعم، التقط صورة للضرر وأبلغ المسؤول المباشر.',
      'यदि हाँ, तो नुकसान की फोटो लें और अपने निकटतम प्रभारी को सूचित करें।') },

  { name: 'f6', kind: 'yesno', section: S2, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar bakgavellyft som den ska? Om nej, beskriv problemet och rapportera till närmsta ansvarig.',
    commentOptions: TAILLIFT.sv,
    i18n: withList(tr(S2,
      'Does the tail lift work as it should? If no, describe the problem and report it to your nearest supervisor.',
      'هل تعمل الرافعة الخلفية كما ينبغي؟ إذا كانت الإجابة لا، صف المشكلة وأبلغ المسؤول المباشر.',
      'क्या टेल लिफ्ट ठीक से काम कर रही है? यदि नहीं, तो समस्या बताएं और सूचित करें।'), TAILLIFT) },

  { name: 'f7', kind: 'yesno', section: S3, required: true, alertOn: ['nej', 'annat'],
    label: 'Är vätskor kontrollerade tex, olja, glykol, spolarvätska? Svara ja eller nej.',
    commentOptions: FLUIDS.sv,
    i18n: withList(tr(S3,
      'Have the fluids been checked – oil, coolant, washer fluid? Answer yes or no.',
      'هل تم فحص السوائل مثل الزيت وسائل التبريد وسائل غسل الزجاج؟ أجب بنعم أو لا.',
      'क्या तरल पदार्थ जाँचे गए हैं – तेल, कूलेंट, वॉशर द्रव? हाँ या नहीं में उत्तर दें।'), FLUIDS) },

  { name: 'f8', kind: 'yesno', section: S3, required: true, alertOn: ['nej', 'annat'],
    label: 'Är bilen fulltankad (HVO)? Svara ja eller nej.',
    commentOptions: FUELLING.sv,
    i18n: withList(tr(S3,
      'Is the vehicle fully fuelled (HVO)? Answer yes or no.',
      'هل المركبة ممتلئة بالوقود (HVO)؟ أجب بنعم أو لا.',
      'क्या वाहन पूरी तरह ईंधन से भरा है (HVO)? हाँ या नहीं में उत्तर दें।'), FUELLING) },

  { name: 'f9', kind: 'select', section: S3, required: true, options: ADBLUE,
    label: 'Är fordonet tankat med ADBLUE (mer än 30%)? Svara i hur många procent det finns.',
    i18n: tr(S3,
      'Is the vehicle filled with AdBlue (more than 30%)? State the percentage remaining.',
      'هل المركبة مزوّدة بـ AdBlue (أكثر من 30%)؟ حدّد النسبة المتبقية.',
      'क्या वाहन में AdBlue भरा है (30% से अधिक)? शेष प्रतिशत बताएं।') },

  { name: 'f10', kind: 'yesno', section: S4, required: true, alertOn: ['ja', 'annat'],
    commentSource: 'lights',
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
    commentOptions: BELTS.sv,
    i18n: withList(tr(S4,
      'Does the seat belt buckle work as it should? Answer yes or no.',
      'هل يعمل قفل حزام الأمان كما ينبغي؟ أجب بنعم أو لا.',
      'क्या सीट बेल्ट का बकल ठीक से काम कर रहा है? हाँ या नहीं में उत्तर दें।'), BELTS) },

  { name: 'f12', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Är bilen städad? (inga lösa föremål i hytt). Svara ja eller nej.',
    commentOptions: CLEAN.sv,
    i18n: withList(tr(S4,
      'Is the cab clean? (no loose objects in the cab). Answer yes or no.',
      'هل المقصورة نظيفة؟ (لا توجد أغراض سائبة في المقصورة). أجب بنعم أو لا.',
      'क्या केबिन साफ़ है? (केबिन में कोई ढीली वस्तु नहीं)। हाँ या नहीं में उत्तर दें।'), CLEAN) },

  { name: 'f13', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar vindrutetorkarna? Svara ja eller nej. Om nej, rapportera till närmast ansvarig.',
    commentOptions: WIPERS.sv,
    i18n: withList(tr(S4,
      'Do the windscreen wipers work? Answer yes or no. If no, report it to your nearest supervisor.',
      'هل تعمل مسّاحات الزجاج الأمامي؟ أجب بنعم أو لا. إذا كانت الإجابة لا، أبلغ المسؤول المباشر.',
      'क्या विंडस्क्रीन वाइपर काम कर रहे हैं? हाँ या नहीं। यदि नहीं, तो सूचित करें।'), WIPERS) },

  { name: 'f14', kind: 'yesno', section: S4, required: true, alertOn: ['nej', 'annat'],
    label: 'Fungerar backkameran om denna finns på fordonet? Svara ja eller nej.',
    commentOptions: CAMERA.sv,
    i18n: withList(tr(S4,
      'Does the reversing camera work, if the vehicle has one? Answer yes or no.',
      'هل تعمل كاميرا الرجوع إن وُجدت في المركبة؟ أجب بنعم أو لا.',
      'क्या रिवर्स कैमरा काम कर रहा है, यदि वाहन में है? हाँ या नहीं में उत्तर दें।'), CAMERA) },

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
/* The seven vans IBX owns are IVECO Daily, each with a Zepro tail lift —
   proved one by one from their lift inspection certificates (Bilprovningen,
   "Fordon: IVECO", chassis numbers ZCFC7…/ZCFCB…). The rented ones and the
   home fleet have no model recorded yet; their model is set under
   Admin → Fordon, and until then they get the shared warning-light list. */
const IVECO = 'iveco-daily';

const DEFAULT_VEHICLES = [
  { plate: 'ODW03R', owner: 'okq8', fleet: 'box' },
  { plate: 'RBE87T', owner: 'okq8', fleet: 'box' },
  { plate: 'XWA50L', owner: 'okq8', fleet: 'box' },
  { plate: 'BPM38R', owner: 'okq8', fleet: 'box' },
  { plate: 'HJA34R', owner: 'okq8', fleet: 'box' },
  { plate: 'BBR00N', owner: 'okq8', fleet: 'box' },
  { plate: 'WAT90D', owner: 'okq8', fleet: 'box' },
  { plate: 'RBE26H', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'RPH54L', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'DHN13H', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'GJR88K', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'ODJ63H', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'ELZ35L', owner: 'own',  fleet: 'box', modelKey: IVECO },
  { plate: 'SSB55B', owner: 'own',  fleet: 'box', modelKey: IVECO },
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
  WHEELS, BODY, TAILLIFT, FLUIDS, FUELLING, BELTS, CLEAN, WIPERS, CAMERA, LEFT_ON, TAKEN,
  SECTION_RENAMES, RETURN_FIELDS, SECTION_RETURN: SR, SECTION_TEXT,
  LAMPS, LAMPS_I18N
};
