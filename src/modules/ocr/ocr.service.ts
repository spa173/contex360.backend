import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Inject,
} from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../database/prisma.service'
import { UsageService } from '../usage/usage.service'
import { STORAGE_PROVIDER, type IStorageProvider } from '../../common/storage/storage.interface'
import { OcrProcessor } from './ocr.processor'
import {
  detectMimeFromBuffer,
  ALLOWED_MIMES,
  MAX_FILE_SIZE_BYTES,
  SYNC_THRESHOLD_BYTES,
} from './ocr.schemas'
import type { OcrUploadDto, OcrListQueryDto } from './ocr.dto'
import type {
  OcrInitiateResponse,
  OcrStatusResponse,
  OcrListItem,
  OcrExtractedFields,
} from './ocr.types'

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
    private readonly processor: OcrProcessor,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: IStorageProvider,
  ) {}

  // ── Upload & initiate ─────────────────────────────────────────────────────

  async initiateUpload(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
    dto: OcrUploadDto,
  ): Promise<OcrInitiateResponse> {

    // 1. Size guard
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `El archivo supera el límite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB. ` +
        `Comprime el PDF o usa una imagen de menor resolución.`,
      )
    }

    // 2. Real MIME detection from magic bytes
    const detected = detectMimeFromBuffer(file.buffer)
    if (!detected) {
      throw new BadRequestException(
        'Tipo de archivo no reconocido. Usa PDF, JPG, PNG o WebP.',
      )
    }
    if (!ALLOWED_MIMES[detected.mime]) {
      throw new BadRequestException(
        `Tipo de archivo no permitido: ${detected.mime}. Usa PDF, JPG, PNG o WebP.`,
      )
    }

    // 3. Quota gate — checked before upload to avoid wasting storage
    const quota = await this.usageService.checkLimit(tenantId, 'ocr_run')
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Límite mensual de OCR alcanzado (${quota.current}/${quota.limit}). ` +
        `Actualiza tu plan en Configuración → Suscripción.`,
      )
    }

    // 4. Sanitize file name
    const originalFileName = sanitizeFilename(file.originalname)

    // 5. Upload to storage (R2 or local)
    const uuid       = randomUUID()
    const storageKey = this.storage.buildKey(tenantId, 'ocr', uuid, detected.ext)

    let fileUrl: string
    try {
      const uploaded = await this.storage.upload(storageKey, file.buffer, detected.mime)
      fileUrl = uploaded.url
    } catch (e: any) {
      this.logger.error(`Storage upload failed for tenant ${tenantId}: ${e.message}`, e.stack)
      throw new BadRequestException(
        'No se pudo almacenar el archivo. Intenta nuevamente en unos segundos.',
      )
    }

    // 6. Persist OcrRun record — rollback storage if DB write fails
    let ocrRun: { id: string }
    try {
      ocrRun = await this.prisma.ocrRun.create({
        data: {
          tenantId,
          status:           'pending',
          fileUrl,
          source:           fileUrl,
          mimeType:         detected.mime,
          fileSizeBytes:    file.size,
          originalFileName,
          fields:           {},
          confidence:       0,
          retryCount:       0,
        },
        select: { id: true },
      })
    } catch (dbError: any) {
      // Storage is already written — attempt rollback to avoid orphaned files in R2
      this.logger.error(
        `OcrRun DB create failed for tenant ${tenantId} after storage upload. ` +
        `Attempting storage rollback for key "${storageKey}": ${dbError.message}`,
        dbError.stack,
      )
      this.storage.delete(storageKey).catch((storageErr: Error) =>
        this.logger.warn(
          `Storage rollback failed for key "${storageKey}": ${storageErr.message}. ` +
          `File may be orphaned in storage — manual cleanup required.`,
        ),
      )
      throw new BadRequestException(
        'No se pudo registrar el documento. Intenta nuevamente en unos segundos.',
      )
    }

    // 7. Audit
    this.createAudit(tenantId, userId, ocrRun.id, originalFileName, file.size)

    // 8. Process: sync for small files, async fire-and-forget for large ones
    const isSmall = file.size <= SYNC_THRESHOLD_BYTES

    if (isSmall) {
      try {
        const result = await this.processor.processSync({
          ocrRunId:           ocrRun.id,
          tenantId,
          fileBuffer:         file.buffer,  // sync: buffer is still in scope (same request)
          mimeType:           detected.mime,
          autoCreatePurchase: dto.autoCreatePurchase ?? false,
        })

        return {
          ocrRunId:   ocrRun.id,
          status:     'processed',
          fields:     result.fields,
          confidence: result.confidence,
          purchaseId: result.purchaseId,
          message:    'Documento procesado exitosamente.',
        }
      } catch (e: any) {
        this.logger.warn(
          `Sync OCR failed for ${ocrRun.id}, falling back to async: ${e.message}`,
        )
        // Fall through to async
      }
    }

    // Async processing (large files or sync failure fallback).
    // Pass fileUrl instead of fileBuffer — the processor will re-fetch from storage.
    // This releases the request-scoped buffer for GC after the HTTP response is sent,
    // preventing 10-23MB allocations from living across retry delays (P0-3).
    this.processor.enqueue({
      ocrRunId:           ocrRun.id,
      tenantId,
      fileUrl:            fileUrl,
      mimeType:           detected.mime,
      autoCreatePurchase: dto.autoCreatePurchase ?? false,
    })

    this.logger.log(
      `OcrRun ${ocrRun.id} enqueued for async processing ` +
      `(${(file.size / 1024).toFixed(0)}KB, ${detected.mime})`,
    )

    return {
      ocrRunId: ocrRun.id,
      status:   'pending',
      message:  'Documento recibido y en cola para procesamiento. Consulta el estado con GET /ocr/:id.',
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  async getStatus(tenantId: string, ocrRunId: string): Promise<OcrStatusResponse> {
    const run = await this.prisma.ocrRun.findFirst({
      where: { id: ocrRunId, tenantId },
    })
    if (!run) throw new NotFoundException('Documento OCR no encontrado')

    return this.toStatusResponse(run)
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async list(
    tenantId: string,
    query: OcrListQueryDto,
  ): Promise<{ data: OcrListItem[]; total: number; page: number; limit: number; totalPages: number }> {
    const page  = query.page  ?? 1
    const limit = query.limit ?? 20
    const skip  = (page - 1) * limit

    const where: any = { tenantId }
    if (query.status)   where.status = query.status
    if (query.search)   where.originalFileName = { contains: query.search, mode: 'insensitive' }

    const [runs, total] = await this.prisma.$transaction([
      this.prisma.ocrRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, status: true, originalFileName: true,
          mimeType: true, confidence: true, fields: true,
          purchaseId: true, createdAt: true,
        },
      }),
      this.prisma.ocrRun.count({ where }),
    ])

    const data: OcrListItem[] = runs.map((r) => {
      const fields = r.fields as Partial<OcrExtractedFields> | null
      return {
        id:               r.id,
        status:           r.status as any,
        originalFileName: r.originalFileName,
        mimeType:         r.mimeType,
        confidence:       r.confidence,
        vendor:           fields?.vendor ?? null,
        total:            fields?.total  ?? null,
        purchaseId:       r.purchaseId,
        createdAt:        r.createdAt,
      }
    })

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  async retry(
    tenantId: string,
    userId: string,
    ocrRunId: string,
    autoCreatePurchase = false,
  ): Promise<OcrInitiateResponse> {

    // 1. Read with tenant isolation — determines run data and initial state
    const run = await this.prisma.ocrRun.findFirst({
      where:  { id: ocrRunId, tenantId },
      select: {
        id: true, status: true, retryCount: true,
        fileUrl: true, mimeType: true,
      },
    })
    if (!run) throw new NotFoundException('Documento OCR no encontrado')

    // 2. Business rule validation — user-friendly messages before the CAS
    if (run.status === 'processing') {
      throw new BadRequestException('El documento ya está siendo procesado.')
    }
    if (run.status === 'processed') {
      throw new BadRequestException(
        'El documento ya fue procesado exitosamente. ' +
        'Si necesitas reprocesarlo, sube el archivo nuevamente.',
      )
    }
    if (run.retryCount >= 5) {
      throw new ForbiddenException(
        'Se alcanzó el límite máximo de reintentos (5). ' +
        'Sube el archivo nuevamente o contacta soporte.',
      )
    }
    if (!run.fileUrl) {
      throw new BadRequestException(
        'No se encontró la URL del archivo para reprocesar. Sube el documento nuevamente.',
      )
    }

    // 3. Quota gate
    const quota = await this.usageService.checkLimit(tenantId, 'ocr_run')
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Límite mensual de OCR alcanzado (${quota.current}/${quota.limit}).`,
      )
    }

    // 4. Optimistic CAS lock — prevents double-retry race condition (P1-1).
    //
    //    The WHERE condition matches the EXACT state read in step 1.
    //    If a concurrent request modified this run between steps 1 and 4,
    //    the UPDATE affects 0 rows → ConflictException.
    //
    //    Scenario: two simultaneous POST /ocr/:id/retry requests both read
    //    status='failed'. First request updates to status='pending' → count=1 ✅.
    //    Second request tries same update but row now has status='pending' → count=0 → 409.
    const locked = await this.prisma.ocrRun.updateMany({
      where: { id: ocrRunId, tenantId, status: run.status },
      data:  { status: 'pending' },
    })

    if (locked.count === 0) {
      throw new ConflictException(
        'El estado del documento cambió mientras procesabas la solicitud. ' +
        'Recarga la página e inténtalo nuevamente.',
      )
    }

    // 5. Enqueue — processor will CAS from 'pending' → 'processing' atomically
    this.processor.enqueue({
      ocrRunId:           run.id,
      tenantId,
      fileUrl:            run.fileUrl,
      mimeType:           run.mimeType ?? 'application/pdf',
      autoCreatePurchase,
    })

    this.logger.log(`OcrRun ${run.id} queued for retry by user ${userId} (retryCount=${run.retryCount})`)

    return {
      ocrRunId: run.id,
      status:   'pending',
      message:  'Documento en cola para reprocesamiento.',
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(tenantId: string, ocrRunId: string): Promise<void> {
    const run = await this.prisma.ocrRun.findFirst({
      where: { id: ocrRunId, tenantId },
    })
    if (!run) throw new NotFoundException('Documento OCR no encontrado')

    if (run.status === 'processing') {
      throw new BadRequestException(
        'No se puede eliminar un documento en procesamiento. Espera a que termine.',
      )
    }

    // Delete from storage (best-effort)
    const key = urlToKey(run.fileUrl)
    if (key) {
      this.storage.delete(key).catch((e: Error) =>
        this.logger.warn(`Storage delete failed for ${ocrRunId}: ${e.message}`),
      )
    }

    await this.prisma.ocrRun.delete({ where: { id: ocrRunId } })
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const now          = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [total, thisMonth, byStatus, avgConfidence] = await Promise.all([
      this.prisma.ocrRun.count({ where: { tenantId } }),
      this.prisma.ocrRun.count({ where: { tenantId, createdAt: { gte: startOfMonth } } }),
      this.prisma.ocrRun.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { id: true },
      }),
      this.prisma.ocrRun.aggregate({
        where: { tenantId, status: 'processed' },
        _avg:  { confidence: true },
      }),
    ])

    const byStatusMap = Object.fromEntries(
      byStatus.map((s) => [s.status, s._count.id]),
    )

    return {
      total,
      thisMonth,
      byStatus: byStatusMap,
      avgConfidence: Number((avgConfidence._avg.confidence ?? 0).toFixed(3)),
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private toStatusResponse(run: any): OcrStatusResponse {
    return {
      id:                    run.id,
      tenantId:              run.tenantId,
      status:                run.status,
      fileUrl:               run.fileUrl,
      mimeType:              run.mimeType,
      fileSizeBytes:         run.fileSizeBytes,
      originalFileName:      run.originalFileName,
      fields:                run.fields && Object.keys(run.fields).length > 0
                               ? run.fields as OcrExtractedFields
                               : null,
      confidence:            run.confidence,
      errorMessage:          run.errorMessage,
      retryCount:            run.retryCount,
      processingStartedAt:   run.processingStartedAt,
      processingCompletedAt: run.processingCompletedAt,
      purchaseId:            run.purchaseId,
      createdAt:             run.createdAt,
      updatedAt:             run.updatedAt,
    }
  }

  private createAudit(
    tenantId: string,
    userId: string,
    ocrRunId: string,
    fileName: string,
    sizeBytes: number,
  ): void {
    this.prisma.auditEvent.create({
      data: {
        tenantId,
        entity:      'ocr_run',
        action:      'OCR iniciado',
        description: `Documento "${fileName}" (${(sizeBytes / 1024).toFixed(0)}KB) subido para extracción OCR. RunId: ${ocrRunId}`,
        actor:       userId,
        actorUserId: userId,
        severity:    'info',
      },
    }).catch((e: Error) =>
      this.logger.warn(`AuditEvent for OCR not persisted: ${e.message}`),
    )
  }

}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._\-\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 200)
}

function urlToKey(url: string): string | null {
  try {
    const u = new URL(url)
    // Remove leading slash from pathname
    return u.pathname.slice(1) || null
  } catch {
    return null
  }
}
