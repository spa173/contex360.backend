/**
 * Parses the CORS_ORIGIN env variable into a value suitable for NestJS enableCors().
 *
 * When credentials are enabled, browsers reject wildcard '*' origins.
 * Returning `true` from NestJS reflects the request origin, which works,
 * but it's safer to list explicit origins whenever possible.
 */
export function parseCorsOrigin(rawOrigin: string | undefined): string | string[] | boolean {
  if (!rawOrigin || rawOrigin.trim() === '*') {
    // Reflect the request origin — works with credentials: true
    return true
  }

  const origins = rawOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    return true
  }

  return origins.length === 1 ? origins[0] : origins
}
