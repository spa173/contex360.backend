export function parseCorsOrigin(rawOrigin: string | undefined): string | string[] | boolean {
  if (!rawOrigin || rawOrigin.trim() === '*') {
    return true
  }

  const origins = rawOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return origins.length <= 1 ? origins[0] : origins
}

