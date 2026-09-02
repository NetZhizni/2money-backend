import CategoryModel from '#sql/CategoryModel'
import { camelizeKeys } from '#util/caseConvert'
import { extractReceiptFromImage } from '#util/gemini'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
// ~6MB decoded (base64 is ~4/3 of that) — generous for a phone photo, well
// under anything a proxy in front of this API would allow through anyway.
const MAX_BASE64_LENGTH = 8_000_000
const MAX_OPERATIONS = 10

const badRequest = (message) => {
  const error = new Error(message)
  error.status = 400
  throw error
}

/** Приймає як голий base64, так і data URL (`data:image/jpeg;base64,...`) з фронтенду. */
function normalizeImage(image, mimeTypeHint) {
  if (typeof image !== 'string' || !image) badRequest('Фото чека обов’язкове')
  const dataUrlMatch = image.match(/^data:([^;]+);base64,(.+)$/s)
  const base64 = dataUrlMatch ? dataUrlMatch[2] : image
  const mimeType = mimeTypeHint || dataUrlMatch?.[1] || 'image/jpeg'
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    badRequest(`Непідтримуваний формат фото: ${mimeType}`)
  }
  if (base64.length > MAX_BASE64_LENGTH) {
    badRequest('Фото завелике — спробуйте стиснути або обрізати його')
  }
  return { base64, mimeType }
}

// Чеки старші за це — практично завжди не "стара покупка", а Gemini
// переплутала цифру в році/даті на нечіткому фото (типово 2026 -> 2020).
// Такі значення відкидаємо як нерозпізнані, а не довіряємо їм наосліп.
const MAX_RECEIPT_AGE_DAYS = 90

/** "YYYY-MM-DD" з чека -> epoch ms; невалідне, майбутнє або неправдоподібно старе значення -> null (фронт сам підставить "сьогодні"). */
function parseReceiptDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const ms = Date.parse(dateStr)
  if (!Number.isFinite(ms)) return null
  const now = Date.now()
  if (ms > now) return null
  if (now - ms > MAX_RECEIPT_AGE_DAYS * 24 * 60 * 60 * 1000) return null
  return ms
}

/**
 * Звіряє одну операцію від Gemini з реальними активними категоріями:
 * відкидає вигадані/архівні id, невірний kind (категорія витрат для
 * income-операції й навпаки) та підкатегорію, що не належить обраній
 * категорії. Повертає null, якщо сама сума невалідна (операцію відкидаємо).
 */
function normalizeOperation(op, categoryById) {
  const amount = Math.round(Number(op?.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null

  const type = op?.type === 'income' ? 'income' : 'expense'

  let categoryId = op?.categoryId && categoryById.has(op.categoryId) ? op.categoryId : null
  if (categoryId && categoryById.get(categoryId).kind !== type) categoryId = null

  let subcategoryId = null
  if (categoryId && op?.subcategoryId && categoryById.has(op.subcategoryId)) {
    const sub = categoryById.get(op.subcategoryId)
    if (sub.parentId === categoryId) subcategoryId = op.subcategoryId
  }

  const note = typeof op?.description === 'string' ? op.description.trim().slice(0, 300) || null : null

  return { type, amount, categoryId, subcategoryId, note }
}

/**
 * POST /api/receipts/scan — фото чека -> список розпізнаних "операцій".
 *
 * На відміну від решти POST /api/* (upsertTransaction тощо) тут НІЧОГО не
 * пишеться в БД: рахунок оплати (валюта, курс до базової валюти) і саме
 * рішення "зберегти/відредагувати/відкинути" кожну операцію — це виключно
 * фронтенд-логіка (той самий шлях, що й ручне створення операції — див.
 * TransactionFormModal.vue/submit() і stores/transactions.ts), той самий
 * offline-first outbox, той самий клієнтський uuidv7. Бекенд тут — лише
 * "фотографія -> розпізнаний чернетковий список", звірений із реальними
 * категоріями, щоб фронту не доводилось самому валідувати вигадані id.
 */
const scanReceipt = async (req) => {
  const b = req.body
  const { base64, mimeType } = normalizeImage(b.image, b.mimeType)

  const rawCategories = await CategoryModel.listAll({})
  const categories = camelizeKeys(rawCategories).filter((c) => !c.archived)
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const parsed = await extractReceiptFromImage({ imageBase64: base64, mimeType, categories })

  const operations = (Array.isArray(parsed?.operations) ? parsed.operations : [])
    .map((op) => normalizeOperation(op, categoryById))
    .filter(Boolean)
    .slice(0, MAX_OPERATIONS)

  if (!operations.length) {
    const error = new Error('Не вдалося розпізнати жодної операції на фото. Спробуйте інше фото або введіть операцію вручну.')
    error.status = 422
    throw error
  }

  return {
    merchant: parsed?.merchant ?? null,
    date: parseReceiptDate(parsed?.date),
    currency: parsed?.currency ?? null,
    operations,
  }
}

export default scanReceipt
