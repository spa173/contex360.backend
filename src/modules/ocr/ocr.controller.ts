import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthUser } from '../../common/decorators/auth-user.decorator'
import { RequirePlanModule, CheckPlanLimit } from '../auth/plan.decorator'
import type { AuthTokenPayload } from '../auth/auth.types'
import { OcrService } from './ocr.service'
import { OcrUploadDto, OcrListQueryDto, OcrRetryDto } from './ocr.dto'

/**
 * OcrController — HTTP interface for the OCR document extraction system.
 *
 * Plan requirements:
 *   - Starter:    ❌ Not available (OCR module not included)
 *   - Pyme:       ✅ Up to plan.maxOcrRunsPerMonth
 *   - Enterprise: ✅ Unlimited
 *
 * Rate limits:
 *   - Upload:  5 requests / minute (heavy — Gemini Vision call)
 *   - List/Get: standard global throttle
 */
@Controller('ocr')
@UseGuards(AuthGuard, PermissionsGuard)
export class OcrController {
  private readonly logger = new Logger(OcrController.name)

  constructor(private readonly ocrService: OcrService) {}

  /**
   * POST /ocr/upload
   *
   * Upload a document (PDF/JPG/PNG/WebP) for OCR extraction.
   * Returns immediately with a ocrRunId. The extraction runs in the background.
   * Small files (≤2MB) are processed synchronously and return results inline.
   *
   * Multer config:
   *   - Field name: 'file'
   *   - Max size: 10MB (enforced both in Multer and in OcrService)
   *   - Buffer only — no disk writes via Multer
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePlanModule('ai')              // Requires 'ai' module (pyme+)
  @CheckPlanLimit('maxOcrRunsPerMonth') // Enforced by PlanGuard globally
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // Pre-filter by declared Content-Type (real validation happens in service)
        const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff']
        if (allowed.includes(file.mimetype)) {
          cb(null, true)
        } else {
          cb(new BadRequestException(`Tipo de archivo no permitido: ${file.mimetype}`), false)
        }
      },
    }),
  )
  upload(
    @TenantId() tenantId: string,
    @AuthUser() user: AuthTokenPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: OcrUploadDto,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Se requiere un archivo. Envíalo como form-data con el campo "file".',
      )
    }

    this.logger.log(
      `OCR upload: tenant=${tenantId}, size=${file.size}, mime=${file.mimetype}, ` +
      `file=${file.originalname?.slice(0, 40)}`,
    )

    return this.ocrService.initiateUpload(tenantId, user.sub, file, dto)
  }

  /**
   * GET /ocr
   *
   * Paginated list of OCR runs for the tenant.
   */
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query() query: OcrListQueryDto,
  ) {
    return this.ocrService.list(tenantId, query)
  }

  /**
   * GET /ocr/stats
   *
   * Aggregated stats for the current tenant's OCR usage.
   */
  @Get('stats')
  getStats(@TenantId() tenantId: string) {
    return this.ocrService.getStats(tenantId)
  }

  /**
   * GET /ocr/:id
   *
   * Full status and extracted fields for a specific OCR run.
   * Poll this endpoint to check if async processing has completed.
   */
  @Get(':id')
  getOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ocrService.getStatus(tenantId, id)
  }

  /**
   * POST /ocr/:id/retry
   *
   * Retry a failed OCR run. Re-fetches the original file from storage
   * and re-submits to the processing queue.
   * Limited to 5 total retries per run.
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  retry(
    @TenantId() tenantId: string,
    @AuthUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: OcrRetryDto,
  ) {
    return this.ocrService.retry(tenantId, user.sub, id, dto.autoCreatePurchase)
  }

  /**
   * DELETE /ocr/:id
   *
   * Delete an OCR run and its associated file from storage.
   * Cannot delete a run currently being processed.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    await this.ocrService.delete(tenantId, id)
  }
}
