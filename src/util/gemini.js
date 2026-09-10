import axios from 'axios'
import { languageNameFor } from '#util/locale'

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 120000

// Дві flash-lite моделі з відчутно більшими безкоштовними лімітами, ніж у
// решти (підібрано вручну, порівнюючи ліміти в Google AI Studio). Пробуємо
// їх по черзі в цьому порядку: щойно в поточної закінчується ліміт запитів
// (429) чи вона знята з продакшна (404) — переходимо до наступної, замість
// одразу віддавати користувачу помилку.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

// Google's API регулярно віддає транзієнтні 500/503 ("model overloaded"
// тощо) під час пікового навантаження — це минає за секунди, тож замість
// одразу здаватись пробуємо ще раз з exponential backoff + jitter (в межах
// однієї моделі, перш ніж переходити на наступну зі списку MODELS).
// 429 сюди навмисно НЕ входить — на free tier це найчастіше вичерпана
// хвилинна/денна квота (retryDelay ~20-40с), а не миттєвий глюк, і
// обробляється окремо (переходом на наступну модель, без "сліпого" backoff).
const MAX_ATTEMPTS = 3
const RETRYABLE_STATUSES = new Set([500, 503])

// Таймаут/обрив з'єднання (без response — ECONNABORTED, ECONNRESET тощо) —
// рівно 1 спроба на модель: сама спроба вже коштує до TIMEOUT_MS (2хв), і
// повторний такий самий за тривалістю запит не дає підстав чекати на кращий
// результат (60с раніше вже не вистачало стабільно). Якщо й ця спроба не
// вклалась — пробуємо наступну модель, а не чекаємо ще раз на тій самій.
const MAX_NETWORK_ATTEMPTS = 1

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * При 429 Gemini повертає в error.details структуру RetryInfo з полем
 * retryDelay (напр. "32.255677682s") — скільки реально треба почекати перед
 * повтором. Це не наближення, а точне число від самого Google.
 */
function parseRetryDelaySeconds(cause) {
  const details = cause.response?.data?.error?.details
  const retryInfo = details?.find((d) => d['@type']?.includes('RetryInfo'))
  const seconds = parseFloat(retryInfo?.retryDelay)
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * Один виклик generateContent до конкретної моделі з ретраями лише
 * транзієнтних помилок (500/503, обрив з'єднання/таймаут). 429 (вичерпана
 * квота) і 404 (модель знята з продакшна) навмисно НЕ ретраяться тут — це
 * не транзієнтні помилки, і рішення "спробувати наступну модель" приймає
 * виклик вище, в extractReceiptFromImage.
 */
async function callModel(model, body, apiKey) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await axios.post(`${API_URL}/${model}:generateContent`, body, {
        params: { key: apiKey },
        timeout: TIMEOUT_MS,
      })
    } catch (cause) {
      const status = cause.response?.status
      const errorStatus = cause.response?.data?.error?.status
      const isNetworkError = !cause.response // таймаут (ECONNABORTED), обрив з'єднання, DNS тощо

      if (status === 429 || (status === 404 && errorStatus === 'NOT_FOUND')) {
        throw cause
      }

      const retryLimit = isNetworkError ? MAX_NETWORK_ATTEMPTS : MAX_ATTEMPTS
      const isRetryable = RETRYABLE_STATUSES.has(status) || isNetworkError
      if (attempt < retryLimit && isRetryable) {
        const backoffMs = 500 * 2 ** (attempt - 1) + Math.random() * 250
        await sleep(backoffMs)
        continue
      }
      throw cause
    }
  }
}

/**
 * Строгий JSON-контракт відповіді (Gemini's `responseSchema`, OpenAPI-підмножина)
 * — модель зобов'язана повернути рівно цю форму, без markdown-обгортки й вигаданих
 * полів, тож нижче (receipt/scanReceipt.js) достатньо лише звірити categoryId
 * з реальним списком категорій, а не парсити довільний текст.
 */
const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: {
      type: 'STRING',
      nullable: true,
      description: 'Store/merchant name, if visible on the receipt',
    },
    date: {
      type: 'STRING',
      nullable: true,
      description: 'Receipt date in YYYY-MM-DD format, if visible',
    },
    currency: {
      type: 'STRING',
      nullable: true,
      description: 'ISO 4217 currency code, if visible on the receipt',
    },
    operations: {
      type: 'ARRAY',
      description: 'One or more operations, grouped by category',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['expense', 'income'] },
          description: { type: 'STRING', description: 'Short description (item/service names)' },
          amount: { type: 'NUMBER', description: 'Amount in the receipt\'s currency, a positive number' },
          categoryId: {
            type: 'STRING',
            nullable: true,
            description: 'id of a category from the list below, or null',
          },
          subcategoryId: {
            type: 'STRING',
            nullable: true,
            description: 'id of a subcategory from the list below, or null',
          },
        },
        required: ['type', 'description', 'amount'],
      },
    },
  },
  required: ['operations'],
}

/**
 * Формує компактний, читабельний для моделі список категорій — топ-рівень і
 * вкладені підкатегорії разом, окремо за kind, щоб Gemini бачив і id (для
 * відповіді), і людську назву/ієрархію (щоб вибрати правильну).
 */
function formatCategoriesForPrompt(categories) {
  const byKind = { expense: [], income: [] }
  const topById = new Map()
  for (const c of categories) {
    if (!c.parentId) {
      topById.set(c.id, c)
      byKind[c.kind]?.push(c)
    }
  }
  const lines = []
  for (const kind of ['expense', 'income']) {
    lines.push(kind === 'expense' ? 'Expense categories:' : 'Income categories:')
    for (const top of byKind[kind]) {
      lines.push(`- ${top.id} | ${top.name}`)
      for (const sub of categories) {
        if (sub.parentId === top.id) lines.push(`  - ${sub.id} | ${sub.name}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * Інструкції для Gemini навмисно англійською незалежно від locale — це
 * текст ДЛЯ МОДЕЛІ (не для користувача), а англійською вона розуміє
 * інструкції найнадійніше. "Локаль" тут впливає лише на мову згенерованого
 * тексту (description, п.7 нижче) — саме це користувач і бачить.
 */
function buildPrompt(categories, locale) {
  const languageName = languageNameFor(locale)
  return `You are reading a photo of a retail/purchase receipt for a family finance-tracking app.

Task:
1. Read every item/service on the receipt and its amount.
2. Group them into "operations" by meaning: if the whole receipt is essentially one category (e.g. groceries) — return ONE operation for the receipt's full total. If the receipt clearly spans different categories (e.g. groceries + household chemicals + alcohol) — split it into several operations, one per category, each with that category's subtotal.
3. For each operation, first check whether one of the SUBCATEGORIES listed below matches it precisely — subcategories are more specific than their parent category, so prefer a matching subcategory whenever one fits, and only fall back to a bare parent category when no subcategory applies. Use ONLY an id from the list below (never invent one). If you pick a subcategory, return BOTH its parent categoryId AND the subcategoryId. If nothing in the list fits, set categoryId: null.
4. type — "expense" for an ordinary purchase (almost always), "income" only if this is clearly a refund/return receipt.
5. amount — a positive number, the total for that operation in the receipt's currency.
6. Don't invent amounts or items that aren't visible in the photo. If the photo is unclear, do your best with what's legible.
7. Write the "description" field in ${languageName}. Item/merchant names quoted directly from the receipt don't need translating — only compose a generic ${languageName} description when the receipt text itself isn't legible enough to quote.

${formatCategoriesForPrompt(categories)}

Return the answer strictly following the given JSON schema.`
}

/**
 * Викликає Gemini (multimodal) з фото чека + списком категорій, повертає
 * розпарсений JSON-об'єкт за RECEIPT_SCHEMA. Не займається валідацією проти
 * реальних записів БД — це відповідальність виклику в scanReceipt.js.
 *
 * Моделі зі списку MODELS пробуються по черзі: як тільки поточна впирається
 * в ліміт запитів (429) чи стає недоступною (404/500/503/обрив з'єднання
 * після вичерпаних ретраїв), запит повторюється на наступній моделі зі
 * списку — і лише якщо всі вони вичерпані, користувач отримує помилку.
 *
 * `locale` — код мови інтерфейсу викликача (див. #util/locale), впливає
 * лише на мову згенерованого тексту в промпті (description), нічого не
 * ламає, якщо не переданий (тоді buildPrompt сам впаде на англійську).
 * Помилки нижче кидаються з `.code` (стабільний машинний ідентифікатор) —
 * саме за ним фронтенд підбирає локалізований текст (див. frontend's
 * i18n/locales/*.ts, ключі receipts.scanErrors.*); `.message` лишається
 * англійською і призначений для логів/дебагу, а не для показу користувачу.
 */
export async function extractReceiptFromImage({ imageBase64, mimeType, categories, locale }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured on the server')
    error.status = 500
    error.code = 'GEMINI_API_KEY_MISSING'
    throw error
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(categories, locale) },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECEIPT_SCHEMA,
      temperature: 0.2,
      // За замовчуванням flash-моделі "думають" (thinkingLevel: medium) —
      // для структурованого вилучення даних за жорсткою схемою це зайве і
      // помітно сповільнює відповідь. "low" різко скорочує latency, якість
      // розпізнавання чека (просте OCR + вибір категорії зі списку) не
      // потребує глибоких міркувань.
      thinkingConfig: { thinkingLevel: 'low' },
    },
  }

  let response
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i]
    const isLastModel = i === MODELS.length - 1
    try {
      response = await callModel(model, body, apiKey)
      break
    } catch (cause) {
      const status = cause.response?.status

      if (!isLastModel) {
        console.warn(
          `[gemini] Модель "${model}" недоступна (${status || cause.code || cause.message}) — переходжу на "${MODELS[i + 1]}".`,
        )
        continue
      }

      if (status === 429) {
        // На free tier це майже завжди вичерпана хвилинна/денна квота, а не
        // миттєвий глюк — Google сам каже почекати десятки секунд
        // (retryDelay). Обидві моделі вичерпані, тож віддаємо .code +
        // retrySeconds (коли Google його повернув) — саме за retrySeconds
        // фронтенд підставляє реальний час очікування у локалізований текст
        // (receipts.scanErrors.rateLimitedIn), а не парсить .message.
        const retrySeconds = parseRetryDelaySeconds(cause)
        const error = new Error(
          retrySeconds
            ? `Gemini rate limit exceeded (all available models). Try again in about ${Math.ceil(retrySeconds)} seconds.`
            : 'Gemini rate limit exceeded (all available models). Try again later.',
        )
        error.status = 429
        error.code = 'GEMINI_RATE_LIMITED'
        if (retrySeconds) error.data = { retrySeconds: Math.ceil(retrySeconds) }
        error.cause = cause
        throw error
      }

      const error = new Error(
        `Failed to reach the Gemini API: ${cause.response?.data?.error?.message || cause.message}`,
      )
      error.status = 502
      error.code = 'GEMINI_REQUEST_FAILED'
      error.cause = cause
      throw error
    }
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    const finishReason = response.data?.candidates?.[0]?.finishReason
    const error = new Error(
      `Gemini did not return a recognized result (${finishReason || 'empty response'})`,
    )
    error.status = 502
    error.code = 'GEMINI_EMPTY_RESPONSE'
    throw error
  }

  try {
    return JSON.parse(text)
  } catch (cause) {
    const error = new Error('Gemini returned invalid JSON')
    error.status = 502
    error.code = 'GEMINI_INVALID_JSON'
    error.cause = cause
    throw error
  }
}
