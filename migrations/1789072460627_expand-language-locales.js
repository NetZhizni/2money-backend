const schema = 'fin'

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * The frontend's language picker (see frontend's i18n/locale.ts) grew from
 * just uk/en to 21 languages (LanguagePickerModal.vue), but every PATCH
 * /settings { language } for anything outside uk/en/system was silently
 * failing against `app_settings_language_check` (added in
 * 1788549967682_add-currency-format-settings.js) — the frontend only logs a
 * warning on that failure (see i18n/locale.ts's setLocaleSetting), so the
 * device kept working off its own localStorage, it just never got backed up
 * for seedLocaleSettingFromBackend to pick up on a fresh device. Widens the
 * check to the full current locale list instead of dropping it entirely, so
 * a typo'd/unsupported code still gets rejected up front rather than stored
 * silently.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.dropConstraint({ schema, name: 'app_settings' }, 'app_settings_language_check')
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_language_check', {
    check: "language in ('system', 'uk', 'en', 'ru', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'ro', 'cs', 'sk', 'hu', 'nl', 'sv', 'tr', 'ar', 'zh', 'ja', 'ko', 'hi')",
  })
}

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropConstraint({ schema, name: 'app_settings' }, 'app_settings_language_check')
  pgm.addConstraint({ schema, name: 'app_settings' }, 'app_settings_language_check', {
    check: "language in ('system', 'uk', 'en')",
  })
}
