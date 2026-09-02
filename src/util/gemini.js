import axios from 'axios'

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

// Google's API регулярно віддає транзієнтні 429/500/503 ("model overloaded"
// тощо) під час пікового навантаження — це минає за секунди, тож замість
// одразу здаватись пробуємо ще раз з exponential backoff + jitter.
const MAX_ATTEMPTS = 3
const RETRYABLE_STATUSES = new Set([429, 500, 503])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Строгий JSON-контракт відповіді (Gemini's `responseSchema`, OpenAPI-підмножина)
 * — модель зобов'язана повернути рівно цю форму, без markdown-обгортки й вигаданих
 * полів, тож нижче (receipt/scanReceipt.js) достатньо лише звірити categoryId
 * з реальним списком категорій, а не парсити довільний текст.
 */
const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING', nullable: true, description: 'Назва магазину/закладу, якщо видно на чеку' },
    date: { type: 'STRING', nullable: true, description: 'Дата чека у форматі YYYY-MM-DD, якщо видно' },
    currency: { type: 'STRING', nullable: true, description: 'ISO 4217 код валюти, якщо видно на чеку' },
    operations: {
      type: 'ARRAY',
      description: 'Одна або декілька операцій, згрупованих за категорією',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['expense', 'income'] },
          description: { type: 'STRING', description: 'Короткий опис (назви товарів/послуг)' },
          amount: { type: 'NUMBER', description: 'Сума в валюті чека, додатне число' },
          categoryId: { type: 'STRING', nullable: true, description: 'id категорії зі списку нижче, або null' },
          subcategoryId: { type: 'STRING', nullable: true, description: 'id підкатегорії зі списку нижче, або null' },
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await axios.post(`${API_URL}/${MODEL}:generateContent`, body, {
        params: { key: apiKey },
        timeout: 30000,
      })
      break
    } catch (cause) {
      const status = cause.response?.status
      if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(status)) {
        const backoffMs = 500 * 2 ** (attempt - 1) + Math.random() * 250
        await sleep(backoffMs)
        continue
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
    const error = new Error(`Gemini не повернув розпізнаний результат (${finishReason || 'порожня відповідь'})`)
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
