const error = async (error, req, res, next) => {
  const errorResponse = {
    name: `${error?.name}`,
    message: `${error?.message}`,
    stack: `${error?.stack}`,
    // `.code` — стабільний машинний ідентифікатор для business-помилок, що
    // мають бути показані користувачу (див. services/internal/receipt/
    // scanReceipt.js, util/gemini.js): фронтенд перекладає за ним замість
    // парсингу `.message` (яке лишається англійською, для логів/дебагу).
    // `.data` — додаткові параметри для підстановки в переклад (напр.
    // retrySeconds). Обидва — лише коли помилка їх задає.
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.data ? { data: error.data } : {}),
  }
  // Every intentional business error already sets its own `.status` (401/403/404/409 — see the
  // `services/internal/**` throws and middleware/auth.js). Anything that reaches here without one is an
  // *unexpected* failure (a bug, a DB error, ...) — that's a 500, not a 400. Defaulting to 400 made every
  // real server-side crash look like an ordinary client mistake, which also fooled the frontend's
  // "is the backend online" check (src/api/http.ts) into reporting the server as fine while it was erroring.
  res.status(error?.status || 500).json(errorResponse)
}

export default error
