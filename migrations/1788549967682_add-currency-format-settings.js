const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * Backend-side counterpart to the frontend's Settings → "Формат валюти" /
 * "Формат чисел" / "Формат дат" / "Мова" (see frontend's utils/format.ts and
 * i18n/locale.ts) plus the per-account/per-category currency-display
 * override (frontend's Account.currencyDisplay/Category.currencyDisplay).
 *
 * app_settings gets one column per device-local preference — purely a
 * cross-device backup each client best-effort PATCHes on change and adopts
 * on a fresh device with nothing of its own yet (see the frontend's
 * seedFormatSettingsFromBackend/seedLocaleSettingFromBackend); the app
 * itself always keeps rendering from its own localStorage, never straight
 * from this table. `currency_display` here doubles as the BASE choice every
 * account/category without its own override falls back to.
 *
 * accounts/categories each get their own nullable `currency_display`: unset
 * means "use the base app_settings choice", exactly like `categories.currency`
 * already means "no fixed currency" before it became mandatory.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn({ schema, name: 'app_settings' }, {
    language: { type: 'text', notNull: true, default: 'system' },
    number_format: { type: 'text', notNull: true, default: 'auto' },
    date_format: { type: 'text', notNull: true, default: 'iso' },
    currency_display: { type: 'text', notNull: true, default: 'narrowSymbol' },
  })
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_language_check', {
    check: "language in ('system', 'uk', 'en')",
  })
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_number_format_check', {
    check: "number_format in ('auto', 'uk', 'us', 'eu')",
  })
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_date_format_check', {
    check: "date_format in ('iso', 'dmy', 'mdy')",
  })
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_currency_display_check', {
    check: "currency_display in ('symbol', 'narrowSymbol', 'code', 'name')",
  })

  pgm.addColumn({ schema, name: 'accounts' }, {
    currency_display: { type: 'text' },
  })
  pgm.addConstraint({ schema, name: 'accounts' }, 'accounts_currency_display_check', {
    check: "currency_display in ('symbol', 'narrowSymbol', 'code', 'name')",
  })

  pgm.addColumn({ schema, name: 'categories' }, {
    currency_display: { type: 'text' },
  })
  pgm.addConstraint({ schema, name: 'categories' }, 'categories_currency_display_check', {
    check: "currency_display in ('symbol', 'narrowSymbol', 'code', 'name')",
  })
}

export const down = (pgm) => {
  pgm.dropColumn({ schema, name: 'categories' }, 'currency_display')
  pgm.dropColumn({ schema, name: 'accounts' }, 'currency_display')
  pgm.dropColumn({ schema, name: 'app_settings' }, ['language', 'number_format', 'date_format', 'currency_display'])
}
