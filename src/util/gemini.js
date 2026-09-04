import axios from 'axios'

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
      description: 'Назва магазину/закладу, якщо видно на чеку',
    },
    date: {
      type: 'STRING',
      nullable: true,
      description: 'Дата чека у форматі YYYY-MM-DD, якщо видно',
    },
    currency: {
      type: 'STRING',
      nullable: true,
      description: 'ISO 4217 код валюти, якщо видно на чеку',
    },
    operations: {
      type: 'ARRAY',
      description: 'Одна або декілька операцій, згрупованих за категорією',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['expense', 'income'] },
          description: { type: 'STRING', description: 'Короткий опис (назви товарів/послуг)' },
          amount: { type: 'NUMBER', description: 'Сума в валюті чека, додатне число' },
          categoryId: {
            type: 'STRING',
            nullable: true,
            description: 'id категорії зі списку нижче, або null',
          },
          subcategoryId: {
            type: 'STRING',
            nullable: true,
            description: 'id підкатегорії зі списку нижче, або null',
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
    lines.push(kind === 'expense' ? 'Категорії витрат:' : 'Категорії доходів:')
    for (const top of byKind[kind]) {
      lines.push(`- ${top.id} | ${top.name}`)
      for (const sub of categories) {
        if (sub.parentId === top.id) lines.push(`  - ${sub.id} | ${sub.name}`)
      }
    }
  }
  return lines.join('\n')
}

function buildPrompt(categories) {
  return `Ти розпізнаєш фото товарного чека (касового чека) для сімейного застосунку обліку фінансів.

Завдання:
1. Прочитай усі товари/послуги на чеку та їхні суми.
2. Згрупуй їх у операції ("operations") за змістом: якщо весь чек по суті одна категорія (наприклад, продукти) — поверни ОДНУ операцію на всю суму чека. Якщо чек явно охоплює різні категорії (наприклад, продукти + побутова хімія + алкоголь) — розбий на декілька операцій, по одній на кожну категорію, з сумою по цій категорії.
3. Для кожної операції вибери НАЙБІЛЬШ ПІДХОДЯЩУ категорію ТІЛЬКИ зі списку нижче (використовуй саме id зі списку, нічого не вигадуй). Якщо є доречна підкатегорія — вкажи і categoryId (батьківську), і subcategoryId. Якщо підходящої категорії немає — постав categoryId: null.
4. type — "expense" для звичайної покупки (майже завжди), "income" тільки якщо це явно повернення коштів/чек повернення.
5. amount — додатне число, сума саме цієї операції в валюті чека.
6. Не вигадуй суми чи товари, яких не видно на фото. Якщо фото нечітке — постарайся розпізнати те, що можливо.

${formatCategoriesForPrompt(categories)}

Поверни відповідь строго за заданою JSON-схемою.`
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
 */
export async function extractReceiptFromImage({ imageBase64, mimeType, categories }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY не налаштовано на сервері')
    error.status = 500
    throw error
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildPrompt(categories) },
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
        // (retryDelay). Обидві моделі вичерпані, тож віддаємо зрозумілу
        // користувачу помилку з реальним часом очікування.
        const retrySeconds = parseRetryDelaySeconds(cause)
        const error = new Error(
          retrySeconds
            ? `Вичерпано ліміт запитів до Gemini (усі доступні моделі). Спробуйте ще раз приблизно через ${Math.ceil(retrySeconds)} секунд.`
            : 'Вичерпано ліміт запитів до Gemini (усі доступні моделі). Спробуйте трохи пізніше.',
        )
        error.status = 429
        error.cause = cause
        throw error
      }

      const error = new Error(
        `Не вдалося звернутись до Gemini API: ${cause.response?.data?.error?.message || cause.message}`,
      )
      error.status = 502
      error.cause = cause
      throw error
    }
  }

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    const finishReason = response.data?.candidates?.[0]?.finishReason
    const error = new Error(
      `Gemini не повернув розпізнаний результат (${finishReason || 'порожня відповідь'})`,
    )
    error.status = 502
    throw error
  }

  try {
    return JSON.parse(text)
  } catch (cause) {
    const error = new Error('Gemini повернув некоректний JSON')
    error.status = 502
    error.cause = cause
    throw error
  }
}
