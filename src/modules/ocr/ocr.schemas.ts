/**
 * OCR Schema Validators
 *
 * Hand-rolled schema validation for LLM output — no external dependency needed.
 * Follows the same safeParse pattern as Zod for easy migration if Zod is added.
 *
 * These validators protect the database from malformed LLM responses.
 */

import type { OcrExtractedFields, OcrLineItem, OcrLlmResponse, DetectedMime } from './ocr.types'

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
  return isNaN(n) ? null : n
}

function coerceString(value: unknown, maxLen = 500): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
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
  const confidence = rawConfidence !== null ? clamp(rawConfidence, 0, 1) : 0.5

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
 * Extract JSON from LLM text that may include markdown fences or prose.
 */
export function extractJsonFromLlmText(text: string): unknown {
  // Try markdown JSON fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* fall through */ }
  }

  // Try to find first { ... } block
  const firstBrace = text.indexOf('{')
  const lastBrace  = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)) } catch { /* fall through */ }
  }

  return null
}
