/**
 * GET /api/config/public — єдиний маршрут, що відповідає БЕЗ авторизації
 * (див. backend/src/index.js: змонтований до authGoogle, а не через
 * routers/index.js). Віддає те небагато, що фронтенду треба знати про
 * бекенд ЩЕ ДО того, як у нього взагалі з'явиться Firebase-сесія:
 *  - веб-конфіг Firebase (apiKey/authDomain/...) — ним ініціалізується
 *    firebase/auth на клієнті (див. frontend/src/firebase.ts). Це НЕ
 *    секрет: Firebase сам документує, що захист веб-конфіга — це
 *    Authorized Domains + Security Rules на боці Firebase, а не
 *    приховування цих значень (вони й так видні в будь-якому зібраному JS-бандлі).
 *  - features.receiptScanning — чи є сенс взагалі показувати кнопку
 *    "скан чека" (сервер без GEMINI_API_KEY відхилить запит помилкою 500,
 *    див. util/gemini.js).
 *
 * НІКОЛИ не включати сюди GOOGLE_PRIVATE_KEY та інші поля сервіс-акаунту
 * (див. util/firebaseAdmin.js) — це секрет admin SDK, до веб-конфіга
 * стосунку не має.
 */
const getPublicConfig = async () => {
  const firebase = {
    apiKey: process.env.FIREBASE_WEB_API_KEY,
    authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN,
    // Той самий Firebase-проєкт, що й у сервіс-акаунту (GOOGLE_PROJECT_ID,
    // див. util/firebaseAdmin.js) — інакше verifyIdToken на бекенді ніколи
    // не прийме токен, виданий цим веб-конфігом. Не дублюємо окремою
    // змінною, щоб таке розсинхронування стало просто неможливим.
    projectId: process.env.GOOGLE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_WEB_APP_ID,
  }

  if (!firebase.apiKey || !firebase.projectId || !firebase.appId) {
    const error = new Error(
      'Сервер не налаштований: відсутні FIREBASE_WEB_* змінні оточення (див. .env.example)',
    )
    error.status = 500
    throw error
  }

  return {
    service: '2money-backend',
    firebase,
    features: {
      receiptScanning: Boolean(process.env.GEMINI_API_KEY),
    },
  }
}

export default getPublicConfig
