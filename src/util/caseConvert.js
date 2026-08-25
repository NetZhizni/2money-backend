const snakeToCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())

/**
 * Recursively converts snake_case object keys (Postgres row shape) to
 * camelCase (the wire/TS-model shape the frontend — ported from FinTrack —
 * expects). `timestamptz` columns come back from `pg` as JS `Date` objects;
 * those become epoch-ms numbers here too, since every date/createdAt/
 * updatedAt field in the ported FinTrack model types is `number`.
 */
export function camelizeKeys(value) {
  if (value instanceof Date) return value.getTime()
  if (Array.isArray(value)) return value.map(camelizeKeys)
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, v] of Object.entries(value)) {
      result[snakeToCamel(key)] = camelizeKeys(v)
    }
    return result
  }
  return value
}
