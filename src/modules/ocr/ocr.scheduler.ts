import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'

/**
 * OcrScheduler — background maintenance for the OCR subsystem.
 *
 * Responsibility: detect and recover OcrRuns that got stuck in 'processing'
 * or 'pending' after a container restart, OOM, or unhandled crash. Without
 * this cron, jobs lost mid-flight remain in these states permanently because
 * the fire-and-forget processor has no persistence layer.
 *
 * Recovery policy:
 *   - A run is "stuck" if it has been in 'processing' or 'pending' for > STUCK_THRESHOLD_MS
 *     without being updated (updatedAt not advancing).
 *   - If retryCount < MAX_AUTO_RETRIES: reset to 'pending' + increment retryCount so the
 *     user (or a future Bull queue migration) can pick it up.
 *   - If retryCount >= MAX_AUTO_RETRIES: mark as 'failed' with a clear reason.
 *
 * Note: this cron does NOT re-enqueue jobs automatically because the fileBuffer
 * is not persisted (it was in RAM). Re-processing requires a manual retry via
 * POST /ocr/:id/retry which re-fetches the file from storage.
 */
@Injectable()
export class OcrScheduler {
  private readonly logger = new Logger(OcrScheduler.name)

  private static readonly STUCK_THRESHOLD_MS  = 10 * 60 * 1000  // 10 min without update
  private static readonly MAX_AUTO_RETRIES    = 2                 // auto-reset up to 2 times
  private static readonly BATCH_SIZE          = 50

  constructor(private readonly prisma: PrismaService) {}

  @Cron('*/5 * * * *', { name: 'ocr-stuck-job-recovery' })
  async recoverStuckJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - OcrScheduler.STUCK_THRESHOLD_MS)

    let resetCount  = 0
    let failedCount = 0

    try {
      const stuckRuns = await this.prisma.ocrRun.findMany({
        where: {
          status:     { in: ['processing', 'pending'] },
          updatedAt:  { lt: cutoff },
        },
        take: OcrScheduler.BATCH_SIZE,
        select: {
          id:         true,
          tenantId:   true,
          status:     true,
          retryCount: true,
          updatedAt:  true,
        },
        orderBy: { updatedAt: 'asc' },  // oldest first
      })

      if (stuckRuns.length === 0) return

      this.logger.warn(
        `OCR recovery: found ${stuckRuns.length} stuck run(s) not updated since ${cutoff.toISOString()}`,
      )

      for (const run of stuckRuns) {
        const canAutoReset = run.retryCount < OcrScheduler.MAX_AUTO_RETRIES

        if (canAutoReset) {
          await this.prisma.ocrRun.update({
            where: { id: run.id },
            data: {
              status:       'pending',
              retryCount:   { increment: 1 },
              errorMessage: `Reprocesamiento automático — job perdido tras reinicio del servidor (intento ${run.retryCount + 1}).`,
            },
          })
          resetCount++
          this.logger.log(
            `OCR recovery: reset run ${run.id} (tenant=${run.tenantId}, ` +
            `was=${run.status}, retryCount=${run.retryCount}) → pending`,
          )
        } else {
          await this.prisma.ocrRun.update({
            where: { id: run.id },
            data: {
              status:               'failed',
              errorMessage:         `El procesamiento falló tras ${run.retryCount} reintentos automáticos. ` +
                                    `Usa el botón de reintento manual o sube el documento nuevamente.`,
              processingCompletedAt: new Date(),
            },
          })
          failedCount++
          this.logger.warn(
            `OCR recovery: marked run ${run.id} (tenant=${run.tenantId}) as failed ` +
            `after ${run.retryCount} auto-retries`,
          )
        }
      }

      this.logger.log(
        `OCR recovery complete: ${resetCount} reset to pending, ${failedCount} marked failed`,
      )

      // Audit the recovery batch (tolerant to failure)
      if (stuckRuns.length > 0) {
        this.prisma.auditEvent.create({
          data: {
            tenantId:    'system',
            entity:      'ocr_run',
            action:      'OCR recovery ejecutado',
            description: `Recovery cron: ${resetCount} runs reseteados a pending, ${failedCount} marcados como failed. Cutoff: ${cutoff.toISOString()}`,
            actor:       'Sistema',
            actorUserId: null,
            severity:    'info',
          },
        }).catch((e: Error) =>
          this.logger.warn(`AuditEvent for OCR recovery not persisted: ${e.message}`),
        )
      }
    } catch (e: any) {
      // Cron must never throw — log and swallow
      this.logger.error(`OCR recovery cron failed: ${e.message}`, e.stack)
    }
  }
}
