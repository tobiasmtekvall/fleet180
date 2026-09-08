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
    languageLabel: 'भाषा'
  }
};

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
  LANGS, CODES, DEFAULT_LANG, langOf, meta, UI, t,
  fieldText, formTitle, allFieldText
};
