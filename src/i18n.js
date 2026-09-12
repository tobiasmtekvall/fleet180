'use strict';

/**
 * The four language versions.
 *
 * Swedish is the source: it is what the questions were written in and what
 * the admin edits. The other three are translations of it, held here for
 * interface text and per question in `form_fields.i18n` for the wording the
 * admin controls. Every language is rendered into the page at once, so the
 * flags switch instantly and anything already filled in stays filled in.
 */

const LANGS = [
  { code: 'sv', label: 'Svenska', flag: '🇸🇪', dir: 'ltr', htmlLang: 'sv' },
  { code: 'en', label: 'English', flag: '🇬🇧', dir: 'ltr', htmlLang: 'en' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦', dir: 'rtl', htmlLang: 'ar' },
  { code: 'hi', label: 'हिन्दी',  flag: '🇮🇳', dir: 'ltr', htmlLang: 'hi' }
];

const CODES = LANGS.map(l => l.code);
const DEFAULT_LANG = 'sv';

function langOf(raw) {
  const code = String(raw || '').trim().toLowerCase().slice(0, 5);
  return CODES.includes(code) ? code : DEFAULT_LANG;
}
function meta(code) {
  return LANGS.find(l => l.code === langOf(code));
}

const UI = {
  sv: {
    choose: 'Välj ett alternativ',
    yes: 'Ja', no: 'Nej', other: 'Annat',
    comment: 'Kommentar',
    commentRequired: 'Kommentar (obligatorisk)',
    commentPlaceholder: 'Beskriv vad som är fel',
    openCamera: 'Öppna kamera',
    clear: 'Rensa',
    print: 'Skriv ut / PDF',
    submit: 'Bekräfta och skicka',
    sending: 'Skickar…',
    lastCheck: 'Senaste kontroll:',
    noCheck: 'Ingen kontroll registrerad för detta fordon ännu.',
    required: 'Fältet är obligatoriskt.',
    chooseError: 'Välj ett alternativ i listan.',
    chooseYesNo: 'Välj Ja, Nej eller Annat.',
    commentNeeded: 'Skriv en kommentar när du svarar Annat.',
    notInList: 'Välj ett värde ur listan.',
    invalid: 'Ogiltigt svar.',
    sendFailed: 'Kunde inte skicka kontrollen: ',
    tryAgain: '. Kontrollera nätverket och försök igen.',
    maxPhotos: 'Max 6 bilder per fråga.',
    incomplete: 'frågor är inte korrekt ifyllda.',
    receiptTitle: 'Kontroll registrerad',
    receiptThanks: 'Tack – kontrollen är sparad',
    receiptNo: 'Kvitto nr',
    filledIn: 'Ifylld kontroll',
    newCheck: 'Ny kontroll för',
    allVehicles: 'Alla fordon',
    assignedToday: 'Tilldelad i dag',
    assignedLine: '{driver} är tilldelad {plate} i dag.',
    assignedLineRoute: '{driver} är tilldelad {plate} i dag, rutt {route}.',
    assignedPrefilled: 'Namnet är ifyllt åt dig. Ändra det bara om någon annan kör bilen.',
    assignedNone: 'Ingen förare är tilldelad den här bilen i dag.',
    assignedSeveral: 'Flera förare är tilldelade den här bilen i dag. Se till att ditt eget namn står i förarfältet.',
    changeTitle: 'Byte av förare',
    changeQuestion: '{assigned} var tilldelad {plate} i dag. Har du ersatt föraren, och har du OK från OC eller Fleet Manager att byta bil?',
    changeQuestionRoute: '{assigned} var tilldelad {plate} i dag på rutt {route}. Har du ersatt föraren på rutten, och har du OK från OC eller Fleet Manager att byta bil?',
    changeApprover: 'Namn på den OC eller Fleet Manager som godkänt bytet',
    changeApproverPlaceholder: 'För- och efternamn',
    changeNeedAnswer: 'Svara Ja eller Nej på frågan om förarbytet.',
    changeNeedApprover: 'Skriv namnet på den som godkänt bytet.',
    changeBlocked: 'Kontakta OC eller Fleet Manager innan du kör bilen. Kontrollen går inte att skicka in förrän bytet är godkänt.',
    weekTitle: 'Förare på bilen, senaste 7 dagarna',
    weekNone: 'Ingen förare registrerad på bilen de senaste 7 dagarna.',
    weekAssigned: 'Tilldelad',
    weekChecked: 'Kontroll',
    weekSwapped: 'bytt',
    weekToday: 'i dag',
    pickLabel: 'Vilken fungerar inte?',
    odometerLast: 'Förra avläsningen: {value} km ({date}).',
    odometerFill: 'Fyll i de sista siffrorna.',
    odometerDigits: 'Skriv bara siffror.',
    odometerUnchanged: 'Fyll i resten av mätarställningen.',
    odometerLow: 'Lägre än förra avläsningen ({value} km). Kontrollera siffrorna.',
    languageLabel: 'Språk'
  },
  en: {
    choose: 'Choose an option',
    yes: 'Yes', no: 'No', other: 'Other',
    comment: 'Comment',
    commentRequired: 'Comment (required)',
    commentPlaceholder: 'Describe what is wrong',
    openCamera: 'Open camera',
    clear: 'Clear',
    print: 'Print / PDF',
    submit: 'Confirm and submit',
    sending: 'Sending…',
    lastCheck: 'Last check:',
    noCheck: 'No check recorded for this vehicle yet.',
    required: 'This field is required.',
    chooseError: 'Choose an option from the list.',
    chooseYesNo: 'Choose Yes, No or Other.',
    commentNeeded: 'Write a comment when you answer Other.',
    notInList: 'Choose a value from the list.',
    invalid: 'Invalid answer.',
    sendFailed: 'Could not submit the check: ',
    tryAgain: '. Check your connection and try again.',
    maxPhotos: 'Max 6 photos per question.',
    incomplete: 'questions are not filled in correctly.',
    receiptTitle: 'Check recorded',
    receiptThanks: 'Thank you – the check has been saved',
    receiptNo: 'Receipt no.',
    filledIn: 'Completed check',
    newCheck: 'New check for',
    allVehicles: 'All vehicles',
    assignedToday: 'Assigned today',
    assignedLine: '{driver} is assigned to {plate} today.',
    assignedLineRoute: '{driver} is assigned to {plate} today, route {route}.',
    assignedPrefilled: 'Your name is filled in. Change it only if someone else is driving.',
    assignedNone: 'No driver is assigned to this vehicle today.',
    assignedSeveral: 'Several drivers are assigned to this vehicle today. Make sure your own name is in the driver field.',
    changeTitle: 'Driver change',
    changeQuestion: '{assigned} was assigned {plate} today. Were you swapped in for that driver, and do you have an OK from the OC or Fleet Manager to use this vehicle?',
    changeQuestionRoute: '{assigned} was assigned {plate} today on route {route}. Were you swapped in on that route, and do you have an OK from the OC or Fleet Manager to use this vehicle?',
    changeApprover: 'Who approved it? (OC or Fleet Manager)',
    changeApproverPlaceholder: 'First and last name',
    changeNeedAnswer: 'Answer Yes or No to the driver change question.',
    changeNeedApprover: 'Write the name of the person who approved the change.',
    changeBlocked: 'Contact the OC or Fleet Manager before driving the vehicle. The check cannot be submitted until the change is approved.',
    weekTitle: 'Drivers of this vehicle, last 7 days',
    weekNone: 'No driver recorded for this vehicle in the last 7 days.',
    weekAssigned: 'Assigned',
    weekChecked: 'Checked by',
    weekSwapped: 'swapped',
    weekToday: 'today',
    pickLabel: 'Which one is not working?',
    odometerLast: 'Previous reading: {value} km ({date}).',
    odometerFill: 'Fill in the last digits.',
    odometerDigits: 'Digits only.',
    odometerUnchanged: 'Fill in the rest of the reading.',
    odometerLow: 'Lower than the previous reading ({value} km). Check the digits.',
    languageLabel: 'Language'
  },
  ar: {
    choose: 'اختر خيارًا',
    yes: 'نعم', no: 'لا', other: 'أخرى',
    comment: 'تعليق',
    commentRequired: 'تعليق (إلزامي)',
    commentPlaceholder: 'صف ما هو الخطأ',
    openCamera: 'افتح الكاميرا',
    clear: 'مسح',
    print: 'طباعة / PDF',
    submit: 'تأكيد وإرسال',
    sending: 'جارٍ الإرسال…',
    lastCheck: 'آخر فحص:',
    noCheck: 'لا يوجد فحص مسجّل لهذه المركبة بعد.',
    required: 'هذا الحقل إلزامي.',
    chooseError: 'اختر خيارًا من القائمة.',
    chooseYesNo: 'اختر نعم أو لا أو أخرى.',
    commentNeeded: 'اكتب تعليقًا عند اختيار «أخرى».',
    notInList: 'اختر قيمة من القائمة.',
    invalid: 'إجابة غير صالحة.',
    sendFailed: 'تعذّر إرسال الفحص: ',
    tryAgain: '. تحقّق من الاتصال وحاول مرة أخرى.',
    maxPhotos: 'حد أقصى 6 صور لكل سؤال.',
    incomplete: 'أسئلة لم تُملأ بشكل صحيح.',
    receiptTitle: 'تم تسجيل الفحص',
    receiptThanks: 'شكرًا – تم حفظ الفحص',
    receiptNo: 'رقم الإيصال',
    filledIn: 'الفحص المكتمل',
    newCheck: 'فحص جديد للمركبة',
    allVehicles: 'كل المركبات',
    assignedToday: 'تخصيص اليوم',
    assignedLine: 'المركبة {plate} مخصّصة اليوم لـ {driver}',
    assignedLineRoute: 'المركبة {plate} مخصّصة اليوم لـ {driver}، المسار {route}',
    assignedPrefilled: 'تم ملء الاسم تلقائيًا. غيّره فقط إذا كان يقود المركبة شخص آخر.',
    assignedNone: 'لا يوجد سائق مخصّص لهذه المركبة اليوم.',
    assignedSeveral: 'أكثر من سائق مخصّص لهذه المركبة اليوم. تأكّد من أن اسمك أنت هو المكتوب في خانة السائق.',
    changeTitle: 'تغيير السائق',
    changeQuestion: 'المركبة {plate} كانت مخصّصة اليوم لـ {assigned}. هل حللت محل هذا السائق، وهل لديك موافقة من منسّق العمليات (OC) أو مدير الأسطول (Fleet Manager) على استخدام هذه المركبة؟',
    changeQuestionRoute: 'المركبة {plate} كانت مخصّصة اليوم لـ {assigned} على المسار {route}. هل حللت محل هذا السائق على هذا المسار، وهل لديك موافقة من منسّق العمليات (OC) أو مدير الأسطول (Fleet Manager) على استخدام هذه المركبة؟',
    changeApprover: 'اسم منسّق العمليات أو مدير الأسطول (Fleet Manager) الذي وافق',
    changeApproverPlaceholder: 'الاسم الأول واسم العائلة',
    changeNeedAnswer: 'أجب بنعم أو لا عن سؤال تغيير السائق.',
    changeNeedApprover: 'اكتب اسم الشخص الذي وافق على التغيير.',
    changeBlocked: 'تواصل مع منسّق العمليات أو مدير الأسطول قبل قيادة المركبة. لا يمكن إرسال الفحص قبل الموافقة على التغيير.',
    weekTitle: 'سائقو هذه المركبة خلال آخر 7 أيام',
    weekNone: 'لا يوجد سائق مسجّل لهذه المركبة خلال آخر 7 أيام.',
    weekAssigned: 'التخصيص',
    weekChecked: 'الفحص',
    weekSwapped: 'تغيير السائق',
    weekToday: 'اليوم',
    pickLabel: 'أيّها لا يعمل؟',
    odometerLast: 'القراءة السابقة: {value} كم ({date}).',
    odometerFill: 'أكمل الأرقام الأخيرة.',
    odometerDigits: 'أرقام فقط.',
    odometerUnchanged: 'أكمل بقية قراءة العدّاد.',
    odometerLow: 'أقل من القراءة السابقة ({value} كم). تحقّق من الأرقام.',
    languageLabel: 'اللغة'
  },
  hi: {
    choose: 'एक विकल्प चुनें',
    yes: 'हाँ', no: 'नहीं', other: 'अन्य',
    comment: 'टिप्पणी',
    commentRequired: 'टिप्पणी (आवश्यक)',
    commentPlaceholder: 'बताएं क्या ग़लत है',
    openCamera: 'कैमरा खोलें',
    clear: 'साफ़ करें',
    print: 'प्रिंट / PDF',
    submit: 'पुष्टि करें और भेजें',
    sending: 'भेजा जा रहा है…',
    lastCheck: 'पिछली जाँच:',
    noCheck: 'इस वाहन के लिए अभी कोई जाँच दर्ज नहीं है।',
    required: 'यह फ़ील्ड आवश्यक है।',
    chooseError: 'सूची में से एक विकल्प चुनें।',
    chooseYesNo: 'हाँ, नहीं या अन्य चुनें।',
    commentNeeded: '«अन्य» चुनने पर टिप्पणी लिखें।',
    notInList: 'सूची में से कोई मान चुनें।',
    invalid: 'अमान्य उत्तर।',
    sendFailed: 'जाँच नहीं भेजी जा सकी: ',
    tryAgain: '. कनेक्शन जाँचें और फिर कोशिश करें।',
    maxPhotos: 'प्रति प्रश्न अधिकतम 6 फ़ोटो।',
    incomplete: 'प्रश्न सही ढंग से नहीं भरे गए हैं।',
    receiptTitle: 'जाँच दर्ज हो गई',
    receiptThanks: 'धन्यवाद – जाँच सहेज ली गई है',
    receiptNo: 'रसीद क्रमांक',
    filledIn: 'पूर्ण जाँच',
    newCheck: 'के लिए नई जाँच',
    allVehicles: 'सभी वाहन',
    assignedToday: 'आज असाइन किया गया',
    assignedLine: 'आज वाहन {plate} {driver} को असाइन किया गया है।',
    assignedLineRoute: 'आज वाहन {plate} {driver} को असाइन किया गया है, रूट {route}।',
    assignedPrefilled: 'नाम आपके लिए भर दिया गया है। इसे तभी बदलें जब कोई और वाहन चला रहा हो।',
    assignedNone: 'आज इस वाहन के लिए कोई ड्राइवर असाइन नहीं है।',
    assignedSeveral: 'आज इस वाहन के लिए एक से अधिक ड्राइवर असाइन हैं। ध्यान दें कि ड्राइवर फ़ील्ड में आपका अपना नाम हो।',
    changeTitle: 'ड्राइवर बदलाव',
    changeQuestion: 'आज वाहन {plate} {assigned} को असाइन था। क्या आपको इस ड्राइवर की जगह भेजा गया है, और क्या आपके पास यह वाहन चलाने के लिए OC या फ़्लीट मैनेजर की अनुमति है?',
    changeQuestionRoute: 'आज रूट {route} पर वाहन {plate} {assigned} को असाइन था। क्या आपको उस रूट पर इस ड्राइवर की जगह भेजा गया है, और क्या आपके पास यह वाहन चलाने के लिए OC या फ़्लीट मैनेजर की अनुमति है?',
    changeApprover: 'अनुमति देने वाले OC या फ़्लीट मैनेजर का नाम',
    changeApproverPlaceholder: 'पूरा नाम',
    changeNeedAnswer: 'ड्राइवर बदलने के प्रश्न का उत्तर हाँ या नहीं में दें।',
    changeNeedApprover: 'अनुमति देने वाले व्यक्ति का नाम लिखें।',
    changeBlocked: 'वाहन चलाने से पहले OC या फ़्लीट मैनेजर से संपर्क करें। अनुमति मिलने तक जाँच भेजी नहीं जा सकती।',
    weekTitle: 'पिछले 7 दिनों में इस वाहन के ड्राइवर',
    weekNone: 'पिछले 7 दिनों में इस वाहन के लिए कोई ड्राइवर दर्ज नहीं है।',
    weekAssigned: 'असाइन',
    weekChecked: 'जाँच की',
    weekSwapped: 'बदला गया',
    weekToday: 'आज',
    pickLabel: 'कौन सी काम नहीं कर रही?',
    odometerLast: 'पिछली रीडिंग: {value} किमी ({date})।',
    odometerFill: 'आख़िरी अंक भरें।',
    odometerDigits: 'केवल अंक लिखें।',
    odometerUnchanged: 'रीडिंग के बाक़ी अंक भरें।',
    odometerLow: 'पिछली रीडिंग ({value} किमी) से कम है। अंक जाँचें।',
    languageLabel: 'भाषा'
  }
};

/**
 * A UI string with {placeholders} replaced.
 *
 * The names, plates and routes in these sentences come from the assignment,
 * so the sentence has to be built per language and written into the page for
 * all four at once -- the flags swap text without reloading, and a sentence
 * that came back from the server in one language only would freeze in it.
 */
function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => {
    if (!vars || vars[k] === undefined || vars[k] === null) return m;
    // Every value substituted here is Latin script -- a name, a registration,
    // a route id -- and most of them land inside an Arabic sentence. Without
    // an isolate the bidi algorithm lets a following full stop or comma jump
    // to the wrong end of the plate ("‎.ODW03R"), which is how a driver ends
    // up reading a registration that is not the one on the van. The two
    // characters are invisible in the three left-to-right languages.
    return '\u2068' + String(vars[k]) + '\u2069';
  });
}

/**
 * Fence off a Latin run inside right-to-left text.
 *
 * "\u0644\u0645\u0628\u0629 \u0627\u0644\u0645\u062d\u0631\u0643 (\u0639\u0637\u0644 / EOBD)" is Arabic with four Latin letters in it.
 * Without an isolate the bidi algorithm hands the closing bracket to the
 * Latin run, and when the line wraps the bracket goes with it -- the driver
 * reads a stray "(" at the start of the next line. The same two invisible
 * characters fill() already uses around a plate do the job here, applied to
 * whatever Latin, digits or symbols sit inside a translated phrase.
 *
 * Left-to-right languages are returned untouched: the characters are
 * invisible there, but there is no reason to carry them.
 */
function isolateLatin(text, lang) {
  const info = meta(lang);
  if (!info || info.dir !== 'rtl') return String(text == null ? '' : text);
  return String(text == null ? '' : text)
    .replace(/[A-Za-z0-9][A-Za-z0-9./+&_-]*/g, m => '\u2068' + m + '\u2069');
}

/** One UI string, falling back to Swedish if a translation is missing. */
function t(lang, key) {
  const code = langOf(lang);
  return (UI[code] && UI[code][key]) || UI[DEFAULT_LANG][key] || key;
}

/**
 * A question's label (or section) in one language.
 *
 * Swedish lives in the `label`/`section` columns; the rest in the `i18n`
 * blob. An untranslated question falls back to Swedish rather than showing
 * an empty line -- a driver reading English would rather see the Swedish
 * question than nothing at all.
 */
function fieldText(field, lang, key = 'label') {
  const code = langOf(lang);
  if (code === DEFAULT_LANG) return field[key] || '';
  const blob = field.i18n || {};
  const val = blob[code] && blob[code][key];
  return (val && String(val).trim()) || field[key] || '';
}

function formTitle(form, lang) {
  const code = langOf(lang);
  if (code === DEFAULT_LANG) return form.title;
  const blob = form.i18n || {};
  const val = blob[code] && blob[code].title;
  return (val && String(val).trim()) || form.title;
}

/** Every language's text for one question, for the in-page switcher. */
function allFieldText(field, key = 'label') {
  const out = {};
  for (const code of CODES) out[code] = fieldText(field, code, key);
  return out;
}

module.exports = {
  LANGS, CODES, DEFAULT_LANG, langOf, meta, UI, t, fill,
  fieldText, formTitle, allFieldText, isolateLatin
};
