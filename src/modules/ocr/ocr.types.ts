// ── OCR Status ───────────────────────────────────────────────────────────────

export type OcrStatus = 'pending' | 'processing' | 'processed' | 'failed'

// ── Extracted invoice fields ─────────────────────────────────────────────────

export interface OcrLineItem {
  description: string
  quantity: number
  unitPrice: number
  taxRate: number    // percentage, e.g. 19 for 19% IVA
  subtotal: number
  taxAmount: number
}

export interface OcrExtractedFields {
  /** Company name of the invoice issuer */
  vendor: string | null
  /** NIT/RUT/tax ID of the issuer */
  vendorNit: string | null
  /** Invoice or document number */
  invoiceNumber: string | null
  /** Issue date — ISO 8601 or free-form text */
  date: string | null
  /** Payment due date — ISO 8601 or free-form text */
  dueDate: string | null
  /** Currency code (default: 'COP') */
  currency: string
  /** Line items */
  items: OcrLineItem[]
  /** Subtotal before taxes */
  subtotal: number | null
  /** Total taxes (IVA) */
  taxTotal: number | null
  /** Total including taxes */
  total: number | null
  /** Payment method if mentioned */
  paymentMethod: string | null
  /** Additional notes extracted */
  notes: string | null
}

// ── LLM raw response ─────────────────────────────────────────────────────────

export interface OcrLlmResponse extends OcrExtractedFields {
  /** 0.0–1.0 LLM self-reported confidence */
  confidence: number
}

// ── Service response types ───────────────────────────────────────────────────

export interface OcrInitiateResponse {
  ocrRunId: string
  status: OcrStatus
  /** Present immediately if file was processed synchronously (≤2MB) */
  fields?: OcrExtractedFields
  confidence?: number
  purchaseId?: string
  message: string
}

export interface OcrStatusResponse {
  id: string
  tenantId: string
  status: OcrStatus
  fileUrl: string
  mimeType: string | null
  fileSizeBytes: number | null
  originalFileName: string | null
  fields: OcrExtractedFields | null
  confidence: number
  errorMessage: string | null
  retryCount: number
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  purchaseId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface OcrListItem {
  id: string
  status: OcrStatus
  originalFileName: string | null
  mimeType: string | null
  confidence: number
  vendor: string | null
  total: number | null
  purchaseId: string | null
  createdAt: Date
}

// ── MIME detection ───────────────────────────────────────────────────────────

export interface DetectedMime {
  mime: string
  ext: string
}
