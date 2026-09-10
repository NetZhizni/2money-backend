// Мови, якими фронтенд шле поточну (уже резолвлену з 'system' у конкретний
// код, див. frontend's i18n/locale.ts `locale` ref) мову інтерфейсу в
// заголовку X-App-Locale з кожним запитом (api/http.ts) — той самий список,
// що й frontend's LOCALES. Тут він потрібен для двох речей: (1) звірити
// заголовок з відомим набором, щоб у промпт Gemini не потрапив довільний
// рядок від клієнта, і (2) підказати Gemini людську назву мови (англійською
// — так модель розуміє її надійно незалежно від того, якою мовою написані
// самі інструкції), якою писати розпізнаний текст.
const LANGUAGE_NAMES = {
  uk: 'Ukrainian',
  en: 'English',
  ru: 'Russian',
  pl: 'Polish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ro: 'Romanian',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  nl: 'Dutch',
  sv: 'Swedish',
  tr: 'Turkish',
  ar: 'Arabic',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
}

const DEFAULT_LOCALE = 'en'

/** Локаль запиту з заголовка X-App-Locale; будь-що невідоме/відсутнє тихо падає на англійську, а не ламає запит. */
export function resolveLocale(req) {
  const header = req.headers?.['x-app-locale']
  return typeof header === 'string' && header in LANGUAGE_NAMES ? header : DEFAULT_LOCALE
}

/** Людська назва мови англійською — для інструкцій моделі (buildPrompt у util/gemini.js), не для показу користувачу. */
export function languageNameFor(locale) {
  return LANGUAGE_NAMES[locale] || LANGUAGE_NAMES[DEFAULT_LOCALE]
}
