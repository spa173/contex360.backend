import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../database/prisma.service'
import { GeminiService } from '../ai/gemini.service'
import { UsageService } from '../usage/usage.service'
import { OCR_EXTRACTION_PROMPT } from './ocr.prompts'
import {
  extractJsonFromLlmText,
  parseOcrLlmResponse,
} from './ocr.schemas'
import type { OcrExtractedFields } from './ocr.types'

export interface OcrJob {
  ocrRunId:  string
  tenantId:  string
  mimeType:  string
  autoCreatePurchase: boolean
  /**
   * For sync processing (small files ≤2MB): pass the buffer directly.
   * For async processing (large files >2MB): pass fileUrl instead and
   * the processor will re-fetch from storage, keeping the request-scoped
   * buffer eligible for GC after the HTTP response is sent.
   * Exactly one of fileBuffer or fileUrl must be provided.
   */
  fileBuffer?: Buffer
  fileUrl?:   string
}

export interface ProcessResult {
  fields: OcrExtractedFields
  confidence: number
  purchaseId?: string
  rawLlmPreview: string
  warnings: string[]
}

const MAX_RETRIES       = 3
const RETRY_DELAYS_MS   = [2_000, 5_000, 15_000]
const MAX_RAW_LOG_CHARS = 2_000
const GEMINI_TIMEOUT_MS = 90_000  // 90s — Gemini Vision typically responds in <15s for invoices

/**
 * OcrProcessor — executes OCR extraction as a background job.
 *
 * ## Lock model (P1-1 — race condition elimination)
 *
 * `acquireLock()` performs a Compare-And-Swap via `updateMany`:
 *   - WHERE status IN ('pending', 'failed') → data { status: 'processing' }
 *   - Returns count > 0 if the lock was acquired, 0 if another worker owns it.
 *
 * This ensures exactly-once execution per OcrRun regardless of how many
 * concurrent callers invoke processSync() or enqueue() with the same ocrRunId.
 *
 * `processWithRetry()` acquires the lock ONCE (attempt 0). Internal retries
 * (attempt 1, 2) reuse the same lock — they don't re-acquire it, because
 * the status is already 'processing' (set by the first attempt).
 *
 * `processSync()` acquires the lock and ensures `markFailed()` is called on
 * any exception, leaving the run in a clean 'failed' state so the async
 * fallback path (in OcrService.initiateUpload) can enqueue it and the
 * processor can re-acquire the lock from 'failed'.
 */
@Injectable()
export class OcrProcessor {
  private readonly logger = new Logger(OcrProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
    private readonly usageService: UsageService,
  ) {}

  // ── Public entry points ───────────────────────────────────────────────────

  /**
   * Fire-and-forget entry point — call from OcrService without await.
   * Acquires the CAS lock before processing; silently skips if another
   * worker already owns the run (idempotent).
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
   * Synchronous entry point — awaited inline when file is small (≤ SYNC_THRESHOLD).
   *
   * Acquires the CAS lock before processing. On failure, calls markFailed()
   * to leave the run in a clean 'failed' state before re-throwing, so the
   * async fallback path in initiateUpload() can enqueue it without a conflict.
   *
   * Throws if the lock cannot be acquired (run already owned or completed).
   */
  async processSync(job: OcrJob): Promise<ProcessResult> {
    const locked = await this.acquireLock(job.ocrRunId)
    if (!locked) {
      throw new Error(
        `OcrRun ${job.ocrRunId} is already being processed or was completed — ` +
        `skipping duplicate sync call`,
      )
    }
    try {
      return await this.executeJobCore(job)
    } catch (e: any) {
      // Ensure the run is in 'failed' (not stuck in 'processing') before re-throwing.
      // This lets the initiateUpload() async fallback re-acquire the lock from 'failed'.
      await this.markFailed(job.ocrRunId, e.message)
      throw e
    }
  }

  // ── Lock ──────────────────────────────────────────────────────────────────

  /**
   * CAS atomic lock: transitions status from 'pending' or 'failed' → 'processing'.
   *
   * Uses updateMany so the WHERE + UPDATE are evaluated atomically by PostgreSQL.
   * Returns true if this caller now owns the lock; false if another worker does.
   *
   * Safe to call concurrently: PostgreSQL row-level locking ensures exactly one
   * caller wins the race regardless of request timing.
   */
  private async acquireLock(ocrRunId: string): Promise<boolean> {
    const result = await this.prisma.ocrRun.updateMany({
      where: { id: ocrRunId, status: { in: ['pending', 'failed'] } },
      data: {
        status:              'processing',
        processingStartedAt: new Date(),
        errorMessage:        null,
      },
    })
    return result.count > 0
  }

  // ── Internal execution ────────────────────────────────────────────────────

  private async processWithRetry(job: OcrJob, attempt: number): Promise<void> {
    // Lock is acquired ONCE on the first attempt.
    // Internal retries (attempt > 0) reuse the existing 'processing' lock.
    if (attempt === 0) {
      const locked = await this.acquireLock(job.ocrRunId)
      if (!locked) {
        this.logger.warn(
          `OcrRun ${job.ocrRunId} already claimed by another worker — skipping (idempotent)`,
        )
        return  // not an error — idempotent skip
      }
    }

    try {
      const result = await this.executeJobCore(job)
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

  /**
   * Core job execution — caller MUST have acquired the lock via acquireLock()
   * before calling this method. Does NOT modify the run's status to 'processing'
   * (the lock acquisition handles that).
   */
  private async executeJobCore(job: OcrJob): Promise<ProcessResult> {
    const { ocrRunId, tenantId, mimeType, autoCreatePurchase } = job

    // 1. Determine Gemini model by plan
    const sub = await this.prisma.subscription.findUnique({
      where:  { tenantId },
      select: { planType: true },
    })
    const geminiModel =
      sub?.planType?.toLowerCase() === 'enterprise'
        ? 'gemini-2.5-pro'
        : 'gemini-2.5-flash'

    // 2. Resolve file buffer — for async jobs re-fetch from storage (P0-3: avoid RAM retention)
    let fileBuffer: Buffer
    if (job.fileBuffer) {
      fileBuffer = job.fileBuffer
    } else if (job.fileUrl) {
      this.logger.log(`OcrRun ${ocrRunId}: re-fetching file from storage for async processing`)
      fileBuffer = await this.fetchFileFromStorage(job.fileUrl)
    } else {
      throw new Error('OcrJob must provide either fileBuffer or fileUrl')
    }

    // Convert buffer to base64 data URI for Gemini Vision, then null the reference
    // so the buffer is eligible for GC once encoding is complete.
    const base64  = fileBuffer.toString('base64')
    const dataUri = `data:${mimeType};base64,${base64}`
    fileBuffer    = null as unknown as Buffer  // hint GC

    // 3. Call Gemini with explicit timeout (P0-4: prevents infinite hang)
    // clearTimeout in finally cancels the timer whether Gemini wins or times out,
    // preventing unhandled rejection from the losing side of Promise.race.
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

    // 4. Parse & validate LLM output
    const rawJson = extractJsonFromLlmText(rawLlmText)
    if (rawJson === null) {
      throw new Error('No se pudo extraer JSON de la respuesta del modelo de IA')
    }

    const parsed = parseOcrLlmResponse(rawJson)
    if (!parsed.success) {
      throw new Error(`Respuesta del modelo inválida: ${parsed.error}`)
    }

    if (parsed.warnings.length > 0) {
      this.logger.warn(`OcrRun ${ocrRunId} warnings: ${parsed.warnings.join(' | ')}`)
    }

    const { data: fields, warnings } = parsed as {
      data: OcrExtractedFields & { confidence: number }
      warnings: string[]
    }

    // 5 + 6. Atomic commit: purchase creation (if requested) + OcrRun final update (P1-4).
    //
    // These two writes MUST be in the same $transaction:
    //   - If purchase.create succeeds but ocrRun.update fails → both roll back → no orphaned Purchase
    //   - If the container dies mid-transaction → PostgreSQL rolls back → clean 'processing' state
    //   - On retry: idempotency check in createPurchaseDraftInTx reuses the existing Purchase
    //     instead of creating a duplicate
    //
    // createPurchaseDraftInTx does NOT swallow errors — failure propagates to roll back the TX,
    // which causes executeJobCore to throw, and processWithRetry retries the entire job.
    const purchaseId = await this.prisma.$transaction(async (tx) => {
      let pId: string | undefined

      if (autoCreatePurchase && fields.total !== null && fields.total > 0) {
        pId = await this.createPurchaseDraftInTx(tx, tenantId, ocrRunId, fields)
      }

      await tx.ocrRun.update({
        where: { id: ocrRunId },
        data: {
          status:                'processed',
          fields:                fields as any,
          confidence:            (fields as any).confidence ?? 0,
          rawLlmResponse:        rawLlmPreview,
          purchaseId:            pId ?? null,
          processingCompletedAt: new Date(),
          errorMessage:          null,
        },
      })

      return pId
    })

    // 7. Record usage — after the transaction commits, tolerant to failure
    this.usageService.recordUsage(tenantId, 'ocr_run').catch((e: Error) => {
      this.logger.warn(`UsageRecord for ocr_run not persisted: ${e.message}`)
    })

    return {
      fields,
      confidence:    (fields as any).confidence ?? 0,
      purchaseId,
      rawLlmPreview,
      warnings,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Creates a Purchase draft inside an existing Prisma $transaction.
   *
   * Idempotency (P1-4 guarantee):
   *   The purchase number `OCR-{ocrRunId[0..7]}` is deterministic.
   *   If a previous attempt already created a Purchase with this number
   *   (crash between purchase.create and ocrRun.update), we reuse it
   *   instead of creating a duplicate.
   *
   * Error handling:
   *   - Provider NIT lookup failure is non-fatal → providerId = null (best-effort)
   *   - purchase.create failure IS fatal → propagates to roll back the $transaction
   *     so no orphaned Purchase is created and the OcrRun stays in 'processing'
   *     (eligible for retry via processWithRetry)
   *
   * Returns the purchase id (always a string on success — never undefined).
   */
  private async createPurchaseDraftInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ocrRunId: string,
    fields: OcrExtractedFields,
  ): Promise<string> {
    const purchaseNumber = `OCR-${ocrRunId.slice(0, 8).toUpperCase()}`

    // Idempotency check: if a previous partial attempt already created this Purchase
    // (purchase.create succeeded but ocrRun.update failed or the container crashed),
    // reuse it instead of creating a duplicate.
    const existing = await tx.purchase.findFirst({
      where:  { tenantId, number: purchaseNumber },
      select: { id: true },
    })
    if (existing) {
      this.logger.log(
        `OcrRun ${ocrRunId}: reusing Purchase ${existing.id} from previous attempt (idempotent retry)`,
      )
      return existing.id
    }

    // Provider NIT lookup — best-effort, failure returns null (does not abort the TX)
    let providerId: string | null = null
    if (fields.vendorNit) {
      const nitDigits = fields.vendorNit.replace(/[^0-9]/g, '')
      if (nitDigits.length >= 9) {
        try {
          const provider = await tx.thirdParty.findFirst({
            where:  { tenantId, nit: { contains: nitDigits } },
            select: { id: true },
          })
          providerId = provider?.id ?? null
        } catch {
          // NIT lookup failure is non-fatal — purchase still created without provider
        }
      }
    }

    const subtotal = fields.subtotal ?? 0
    const taxTotal = fields.taxTotal ?? 0
    const total    = fields.total    ?? subtotal + taxTotal

    // purchase.create failure propagates up → rolls back the entire $transaction
    const purchase = await tx.purchase.create({
      data: {
        tenantId,
        providerId,
        number:          purchaseNumber,
        status:          'draft',
        subtotal,
        taxTotal,
        total,
        paymentTermDays: 30,
        notes:           `Borrador generado automáticamente por OCR. Factura: ${fields.invoiceNumber ?? 'N/A'} — ${fields.vendor ?? 'Proveedor desconocido'}`,
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
  }

  private async markFailed(ocrRunId: string, errorMessage: string): Promise<void> {
    try {
      await this.prisma.ocrRun.update({
        where: { id: ocrRunId },
        data: {
          status:                'failed',
          errorMessage:          errorMessage.slice(0, 500),
          processingCompletedAt: new Date(),
        },
      })
    } catch (e: any) {
      this.logger.error(`Could not mark OcrRun ${ocrRunId} as failed: ${e.message}`)
    }
  }

  private async fetchFileFromStorage(url: string): Promise<Buffer> {
    const MAX_BYTES = 10 * 1024 * 1024
    const response  = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      throw new Error(`Storage fetch failed (HTTP ${response.status}) for re-processing`)
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BYTES) {
      throw new Error(`File too large to re-fetch for processing: ${contentLength} bytes`)
    }
    const ab = await response.arrayBuffer()
    if (ab.byteLength > MAX_BYTES) {
      throw new Error(`Fetched file exceeds ${MAX_BYTES / 1024 / 1024}MB limit`)
    }
    return Buffer.from(ab)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
