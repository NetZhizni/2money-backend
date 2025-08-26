/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO account_types (id, name) VALUES
      (1, 'Рахунки'),
      (2, 'Заощадження'),
      (3, 'Борги'),
      (4, 'Доходи'),
      (5, 'Витрати');
  `)

  pgm.sql(`
    INSERT INTO operation_types (id, code, name) VALUES
      (1, 'income', 'Дохід'),
      (2, 'expense', 'Витрата'),
      (3, 'transfer', 'Переказ'),
      (4, 'debt', 'Борг / Кредит'),
      (5, 'other', 'Інше');
  `)

  pgm.sql(`
    INSERT INTO currencies (code, numeric_code, name, symbol, decimal_digits) VALUES
      ('UAH', 980, 'Українська гривня', NULL, 2),
      ('USD', 840, 'Долар США', '$', 2),
      ('EUR', 978, 'Євро', '€', 2),
      ('GBP', 826, 'Фунт стерлінгів Велико­британії', '£', 2),
      ('JPY', 392, 'Японська єна', '¥', 0),
      ('CHF', 756, 'Швейцарський франк', NULL, 2),
      ('CNY', 156, 'Китайський юань женьмiньбi', NULL, 2);
  `)
}

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM transactions;
    DELETE FROM operation_types;
    DELETE FROM accounts;
    DELETE FROM account_types;
    DELETE FROM users;
    DELETE FROM currencies;
    `)

  pgm.sql(`
    DELETE FROM account_types WHERE id IN (1, 2, 3, 4, 5);
    `)
  pgm.sql(
    `
    DELETE FROM operation_types WHERE code IN ('income', 'expense', 'transfer', 'debt', 'other');
    `,
  )
  pgm.sql(
    `
    DELETE FROM currencies
    WHERE code IN ('UAH', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CNY');
    `,
  )
}
