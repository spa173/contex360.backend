import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { GeminiService } from '../ai/gemini.service'
import { UsageService } from '../usage/usage.service'
import { OCR_EXTRACTION_PROMPT } from './ocr.prompts'
import {
  detectMimeFromBuffer,
  extractJsonFromLlmText,
  parseOcrLlmResponse,
} from './ocr.schemas'
import type { OcrExtractedFields } from './ocr.types'

export interface OcrJob {
  ocrRunId: string
  tenantId: string
  fileBuffer: Buffer
  mimeType: string
  autoCreatePurchase: boolean
}

interface ProcessResult {
  fields: OcrExtractedFields
  confidence: number
  purchaseId?: string
  rawLlmPreview: string
  warnings: string[]
}

const MAX_RETRIES          = 3
const RETRY_DELAYS_MS      = [2_000, 5_000, 15_000]
const MAX_RAW_LOG_CHARS    = 2_000
const GEMINI_TIMEOUT_MS    = 90_000  // 90s — Gemini Vision typically responds in <15s for invoices

/**
 * OcrProcessor — executes OCR extraction as a background job.
 *
 * Designed as a plain @Injectable() service so it can be called
 * fire-and-forget from OcrService, or trivially migrated to a
 * @nestjs/bull @Processor() when Bull is configured.
 *
 * Flow:
 *   1. UPDATE OcrRun status → 'processing'
 *   2. Convert buffer to base64 data URI
 *   3. Call Gemini Vision with structured invoice prompt
 *   4. Validate LLM JSON output with parseOcrLlmResponse()
 *   5. Optionally create Purchase draft
 *   6. UPDATE OcrRun status → 'processed' with extracted fields
 *   7. Record UsageRecord { feature: 'ocr_run' }
 *   8. On error: retry with exponential backoff up to MAX_RETRIES
 */
@Injectable()
export class OcrProcessor {
  private readonly logger = new Logger(OcrProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly usageService: UsageService,
  ) {}

  /**
   * Fire-and-forget entry point — call from OcrService without await.
   */
  enqueue(job: OcrJob): void {
    this.processWithRetry(job, 0).catch((e) => {
      this.logger.error(
        `OcrRun ${job.ocrRunId} exhausted all retries: ${e.message}`,
        e.stack,
      )
    })
  }

  /**
   * Synchronous entry point — awaited when file is small (≤ SYNC_THRESHOLD).
   */
  async processSync(job: OcrJob): Promise<ProcessResult> {
    return this.executeJob(job)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async processWithRetry(job: OcrJob, attempt: number): Promise<void> {
    try {
      const result = await this.executeJob(job)
      this.logger.log(
        `OcrRun ${job.ocrRunId} processed: confidence=${result.confidence.toFixed(2)}, ` +
        `warnings=${result.warnings.length}`,
      )
    } catch (e: any) {
      const nextAttempt = attempt + 1
      const willRetry   = nextAttempt < MAX_RETRIES

      this.logger.warn(
        `OcrRun ${job.ocrRunId} attempt ${attempt + 1} failed: ${e.message} ` +
        `(${willRetry ? `retrying in ${RETRY_DELAYS_MS[attempt]}ms` : 'no more retries'})`,
      )

      await this.prisma.ocrRun.update({
        where: { id: job.ocrRunId },
        data:  { retryCount: { increment: 1 }, errorMessage: e.message },
      })

      if (!willRetry) {
        await this.markFailed(job.ocrRunId, e.message)
        return
      }

      await delay(RETRY_DELAYS_MS[attempt])
      return this.processWithRetry(job, nextAttempt)
    }
  }

  private async executeJob(job: OcrJob): Promise<ProcessResult> {
    const { ocrRunId, tenantId, fileBuffer, mimeType, autoCreatePurchase } = job

    // 1. Mark processing
    await this.prisma.ocrRun.update({
      where: { id: ocrRunId },
      data:  { status: 'processing', processingStartedAt: new Date(), errorMessage: null },
    })

    // 2. Determine Gemini model by plan
    const sub = await this.prisma.subscription.findUnique({
      where:  { tenantId },
      select: { planType: true },
    })
    const geminiModel =
      sub?.planType?.toLowerCase() === 'enterprise'
        ? 'gemini-2.5-pro'
        : 'gemini-2.5-flash'

    // 3. Convert buffer to base64 data URI for Gemini Vision
    const base64 = fileBuffer.toString('base64')
    const dataUri = `data:${mimeType};base64,${base64}`

    // 4. Call Gemini with explicit timeout — prevents infinite hang on API unresponsiveness.
    // clearTimeout in finally ensures the pending timer is cancelled whether Gemini wins
    // or times out first, preventing unhandled rejection from the losing Promise.
    let geminiTimeoutId: ReturnType<typeof setTimeout> | undefined
    const geminiTimeout = new Promise<never>((_, reject) => {
      geminiTimeoutId = setTimeout(
        () => reject(new Error(`Gemini no respondió en ${GEMINI_TIMEOUT_MS / 1000}s. El servicio de IA está tardando demasiado.`)),
        GEMINI_TIMEOUT_MS,
      )
    })

    let rawLlmText: string
    try {
      rawLlmText = await Promise.race([
        this.gemini.generateText(
          geminiModel,
          OCR_EXTRACTION_PROMPT,
          'Extrae los datos del documento adjunto según las instrucciones.',
          [],
          dataUri,
        ),
        geminiTimeout,
      ])
    } finally {
      clearTimeout(geminiTimeoutId)
    }

    const rawLlmPreview = rawLlmText.slice(0, MAX_RAW_LOG_CHARS)

    // 5. Parse & validate
    const rawJson = extractJsonFromLlmText(rawLlmText)
    if (rawJson === null) {
      throw new Error('No se pudo extraer JSON de la respuesta del modelo de IA')
    }

    const parsed = parseOcrLlmResponse(rawJson)
    if (!parsed.success) {
      throw new Error(`Respuesta del modelo inválida: ${parsed.error}`)
    }

    if (parsed.warnings.length > 0) {
      this.logger.warn(
        `OcrRun ${ocrRunId} warnings: ${parsed.warnings.join(' | ')}`,
      )
    }

    const { data: fields, warnings } = parsed as { data: OcrExtractedFields & { confidence: number }; warnings: string[] }

    // 6. Optional: create Purchase draft
    let purchaseId: string | undefined
    if (autoCreatePurchase && fields.total !== null && fields.total > 0) {
      purchaseId = await this.createPurchaseDraft(tenantId, ocrRunId, fields)
    }

    // 7. Mark processed
    await this.prisma.ocrRun.update({
      where: { id: ocrRunId },
      data: {
        status:               'processed',
        fields:               fields as any,
        confidence:           (fields as any).confidence ?? 0,
        rawLlmResponse:       rawLlmPreview,
        purchaseId:           purchaseId ?? null,
        processingCompletedAt: new Date(),
        errorMessage:         null,
      },
    })

    // 8. Record usage (outside DB transaction — tolerant to failure)
    this.usageService.recordUsage(tenantId, 'ocr_run').catch((e: Error) => {
      this.logger.warn(`UsageRecord for ocr_run not persisted: ${e.message}`)
    })

    return { fields, confidence: (fields as any).confidence ?? 0, purchaseId, rawLlmPreview, warnings }
  }

  private async createPurchaseDraft(
    tenantId: string,
    ocrRunId: string,
    fields: OcrExtractedFields,
  ): Promise<string | undefined> {
    try {
      // Look up provider by NIT (best-effort)
      let providerId: string | null = null
      if (fields.vendorNit) {
        const nitDigits = fields.vendorNit.replace(/[^0-9]/g, '')
        const provider = await this.prisma.thirdParty.findFirst({
          where: { tenantId, nit: { contains: nitDigits } },
          select: { id: true },
        })
        providerId = provider?.id ?? null
      }

      const subtotal = fields.subtotal ?? 0
      const taxTotal = fields.taxTotal ?? 0
      const total    = fields.total    ?? subtotal + taxTotal

      const purchase = await this.prisma.purchase.create({
        data: {
          tenantId,
          providerId,
          number:         `OCR-${ocrRunId.slice(0, 8).toUpperCase()}`,
          status:         'draft',
          subtotal,
          taxTotal,
          total,
          paymentTermDays: 30,
          notes:          `Borrador generado automáticamente por OCR. Factura: ${fields.invoiceNumber ?? 'N/A'} — ${fields.vendor ?? 'Proveedor desconocido'}`,
          items: {
            create: fields.items.map((item, idx) => ({
              lineNumber:  idx + 1,
              productName: item.description,
              quantity:    item.quantity,
              unitPrice:   item.unitPrice,
              taxRate:     item.taxRate,
              subtotal:    item.subtotal,
              taxAmount:   item.taxAmount,
            })),
          },
        },
        select: { id: true },
      })

      this.logger.log(
        `OcrRun ${ocrRunId}: Purchase draft ${purchase.id} created for tenant ${tenantId}`,
      )

      return purchase.id
    } catch (e: any) {
      this.logger.warn(
        `OcrRun ${ocrRunId}: Could not create Purchase draft: ${e.message}`,
      )
      return undefined
    }
  }

  private async markFailed(ocrRunId: string, errorMessage: string): Promise<void> {
    try {
      await this.prisma.ocrRun.update({
        where: { id: ocrRunId },
        data: {
          status:               'failed',
          errorMessage:         errorMessage.slice(0, 500),
          processingCompletedAt: new Date(),
        },
      })
    } catch (e: any) {
      this.logger.error(`Could not mark OcrRun ${ocrRunId} as failed: ${e.message}`)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
