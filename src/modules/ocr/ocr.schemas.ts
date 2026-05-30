/**
 * OCR Schema Validators
 *
 * Hand-rolled schema validation for LLM output — no external dependency needed.
 * Follows the same safeParse pattern as Zod for easy migration if Zod is added.
 *
 * These validators protect the database from malformed LLM responses.
 */

import type { OcrLineItem, OcrLlmResponse, DetectedMime } from './ocr.types'

// ── Allowed MIME types ────────────────────────────────────────────────────────

export const ALLOWED_MIMES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/jpg':       'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
  'image/tiff':      'tiff',
}

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  // 10 MB
export const SYNC_THRESHOLD_BYTES = 2 * 1024 * 1024  // 2 MB → process inline if below

// ── Magic byte MIME detection (no file-type dependency) ───────────────────────

/**
 * Detect the real MIME type from file magic bytes.
 * Rejects files that don't match the declared Content-Type.
 */
export function detectMimeFromBuffer(buffer: Buffer): DetectedMime | null {
  if (buffer.length < 4) return null

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' }
  }
  // PNG: \x89PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' }
  }
  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  // WebP: RIFF????WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer.length > 11 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  // TIFF: II or MM
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49) ||
    (buffer[0] === 0x4D && buffer[1] === 0x4D)
  ) {
    return { mime: 'image/tiff', ext: 'tiff' }
  }

  return null
}

// ── LLM output schema ─────────────────────────────────────────────────────────

type SafeParseResult<T> =
  | { success: true;  data: T;    warnings: string[] }
  | { success: false; error: string; warnings: string[] }

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function coerceString(value: unknown, maxLen = 500): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return null
  const primitive = value as string | number | boolean
  const s = String(primitive).trim()
  return s.length > 0 ? s.slice(0, maxLen) : null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/**
 * Validates and sanitizes the raw JSON returned by the LLM.
 * Returns cleaned OcrLlmResponse or an error string.
 */
export function parseOcrLlmResponse(raw: unknown): SafeParseResult<OcrLlmResponse> {
  const warnings: string[] = []

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { success: false, error: 'LLM response is not a JSON object', warnings }
  }

  const obj = raw as Record<string, unknown>

  // Validate line items
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items: OcrLineItem[] = []

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i]
    if (typeof item !== 'object' || item === null) {
      warnings.push(`Item ${i} is not an object — skipped`)
      continue
    }
    const it = item as Record<string, unknown>

    const description = coerceString(it.description, 300)
    if (!description) {
      warnings.push(`Item ${i} has no description — skipped`)
      continue
    }

    const quantity  = coerceNumber(it.quantity)  ?? 1
    const unitPrice = coerceNumber(it.unitPrice) ?? 0
    const taxRate   = clamp(coerceNumber(it.taxRate) ?? 19, 0, 100)
    const subtotal  = coerceNumber(it.subtotal) ?? (quantity * unitPrice)
    const taxAmount = coerceNumber(it.taxAmount) ?? (subtotal * taxRate / 100)

    items.push({ description, quantity, unitPrice, taxRate, subtotal, taxAmount })
  }

  // Confidence — clamp to [0, 1]
  const rawConfidence = coerceNumber(obj.confidence)
  const confidence = rawConfidence === null ? 0.5 : clamp(rawConfidence, 0, 1)

  if (rawConfidence === null) {
    warnings.push('confidence not provided by LLM — defaulted to 0.5')
  }

  const fields: OcrLlmResponse = {
    vendor:        coerceString(obj.vendor, 200),
    vendorNit:     coerceString(obj.vendorNit, 30),
    invoiceNumber: coerceString(obj.invoiceNumber, 50),
    date:          coerceString(obj.date, 30),
    dueDate:       coerceString(obj.dueDate, 30),
    currency:      coerceString(obj.currency, 10) ?? 'COP',
    items,
    subtotal:      coerceNumber(obj.subtotal),
    taxTotal:      coerceNumber(obj.taxTotal),
    total:         coerceNumber(obj.total),
    paymentMethod: coerceString(obj.paymentMethod, 100),
    notes:         coerceString(obj.notes, 500),
    confidence,
  }

  // Derived total validation
  if (fields.subtotal !== null && fields.taxTotal !== null && fields.total !== null) {
    const computed = fields.subtotal + fields.taxTotal
    if (Math.abs(computed - fields.total) > 1) {
      warnings.push(`Total mismatch: subtotal(${fields.subtotal}) + tax(${fields.taxTotal}) ≠ total(${fields.total})`)
    }
  }

  return { success: true, data: fields, warnings }
}

/**
 * Extract the first valid JSON object from LLM text that may contain markdown
 * fences, prose before/after the JSON, multiple JSON blocks, or curly braces
 * inside string values.
 *
 * Strategy:
 *   1. Markdown fence (`\`\`\`json … \`\`\``) — fast path for well-formatted output
 *   2. Brace-balancing parser — scans for the first complete, parseable JSON object
 *      using a 3-state automaton (NORMAL / IN_STRING / ESCAPE) so that `{` and `}`
 *      inside string values are correctly ignored.
 *
 * The old firstIndexOf/lastIndexOf approach failed when any text after the JSON
 * contained a `}` character — it would slice up to the wrong `}` and produce
 * unparseable input. The brace-balancing approach is deterministic and handles
 * all real Gemini response formats observed in production.
 */
export function extractJsonFromLlmText(text: string): unknown {
  if (!text) return null

  // 1. Markdown fence — highest priority (Gemini 2.5 reliably uses this)
  // Replaced regex with safe, linear indexOf parsing to eliminate ReDoS / backtracking vulnerability
  let startIdx = text.indexOf('```json')
  let headerLen = 7
  if (startIdx === -1) {
    startIdx = text.indexOf('```')
    headerLen = 3
  }

  if (startIdx !== -1) {
    const searchFrom = startIdx + headerLen
    const endIdx = text.indexOf('```', searchFrom)
    if (endIdx !== -1) {
      const content = text.slice(searchFrom, endIdx).trim()
      try {
        return JSON.parse(content)
      } catch {
        // fall through to brace parser
      }
    }
  }

  // 2. Brace-balancing parser (P1-5: replaces firstIndexOf/lastIndexOf)
  return balancedJsonExtract(text)
}

/**
 * Scans from the opening brace `{` at `start` to find the index of the matching
 * closing brace `}`, ignoring braces inside string literals.
 * Returns the index of the matching closing brace, or -1 if not found.
 */
function findMatchingBrace(text: string, start: number): number {
  const len = text.length
  let depth = 0
  let inString = false
  let escape = false

  for (let j = start; j < len; j++) {
    const ch = text[j]
    if (escape) {
      escape = false
    } else if (inString) {
      if (ch === '\\') escape = true
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return j
    }
  }

  return -1
}

/**
 * Scans `text` left-to-right for the first complete JSON object `{…}` using a
 * brace-depth counter that correctly ignores `{` and `}` inside string literals.
 *
 * When a balanced `{…}` candidate is found, it is passed to JSON.parse:
 *   - Parses ok  → return the value immediately
 *   - SyntaxError → skip past the candidate and continue scanning (handles
 *     cases like `{unquoted: keys}` appearing before the real JSON object)
 *
 * Returns null if no complete, parseable JSON object is found.
 *
 * Exported for unit-testing the parser in isolation.
 */
export function balancedJsonExtract(text: string): unknown {
  const len = text.length
  let scanFrom = 0

  while (scanFrom < len) {
    const start = text.indexOf('{', scanFrom)
    if (start === -1) return null

    const end = findMatchingBrace(text, start)
    if (end === -1) {
      // The brace did not close — truncated JSON, no other candidate possible
      return null
    }

    const candidate = text.slice(start, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      // Invalid JSON — skip past this candidate and search again
      scanFrom = end + 1
    }
  }

  return null
}
