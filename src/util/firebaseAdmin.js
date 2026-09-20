// firebase-admin v12+ dropped the old namespaced default export
// (`admin.credential.cert(...)`) in favor of standalone named exports from
// `firebase-admin/app` etc. `#util/firebaseAdmin`'s own default export keeps
// the `.auth()` shape the rest of the codebase (middleware/auth.js,
// sockets/index.js) already relies on, so callers don't need to change.
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const serviceAccount = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
}

const app = initializeApp({
  credential: cert(serviceAccount),
})

export default {
  auth: () => getAuth(app),
}
