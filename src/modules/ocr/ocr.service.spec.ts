import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { OcrService } from './ocr.service'
import { PrismaService } from '../database/prisma.service'
import { UsageService } from '../usage/usage.service'
import { OcrProcessor } from './ocr.processor'
import { STORAGE_PROVIDER } from '../../common/storage/storage.interface'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  ocrRun: {
    create:    vi.fn(),
    findFirst: vi.fn(),
    findMany:  vi.fn(),
    count:     vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
    groupBy:   vi.fn(),
    aggregate: vi.fn(),
  },
  $transaction: vi.fn(),
  auditEvent: { create: vi.fn() },
}

const mockUsage = {
  checkLimit:    vi.fn(),
  recordUsage:   vi.fn(),
}

const mockProcessor = {
  enqueue:     vi.fn(),
  processSync: vi.fn(),
}

const mockStorage = {
  upload:   vi.fn(),
  delete:   vi.fn(),
  buildKey: vi.fn().mockReturnValue('tenants/t1/ocr/2026-05/uuid.pdf'),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePdfBuffer(): Buffer {
  // Real PDF magic bytes: %PDF
  return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34])
}

function makeFile(override: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'factura_proveedor.pdf',
    encoding:     '7bit',
    mimetype:     'application/pdf',
    buffer:       makePdfBuffer(),
    size:         1024 * 500,  // 500KB
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...override,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OcrService', () => {
  let service: OcrService

  beforeEach(async () => {
    vi.clearAllMocks()

    const module = await Test.createTestingModule({
      providers: [
        OcrService,
        { provide: PrismaService,     useValue: mockPrisma   },
        { provide: UsageService,      useValue: mockUsage    },
        { provide: OcrProcessor,      useValue: mockProcessor },
        { provide: STORAGE_PROVIDER,  useValue: mockStorage  },
      ],
    }).compile()

    service = module.get(OcrService)
  })

  // ── initiateUpload ──────────────────────────────────────────────────────────

  describe('initiateUpload', () => {
    it('returns processed status when file is small and sync succeeds', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 2, limit: 10 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockPrisma.ocrRun.create.mockResolvedValue({ id: 'ocr-1' })
      mockPrisma.auditEvent.create.mockResolvedValue({})
      mockProcessor.processSync.mockResolvedValue({
        fields:     { vendor: 'Proveedor XYZ', total: 119000 },
        confidence: 0.92,
        purchaseId: undefined,
        rawLlmPreview: '{}',
        warnings: [],
      })

      const result = await service.initiateUpload(
        'tenant-1', 'user-1', makeFile(), { autoCreatePurchase: false },
      )

      expect(result.status).toBe('processed')
      expect(result.ocrRunId).toBe('ocr-1')
      expect(result.fields?.vendor).toBe('Proveedor XYZ')
      expect(result.confidence).toBe(0.92)
    })

    it('returns pending status when file exceeds sync threshold', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/large.pdf' })
      mockPrisma.ocrRun.create.mockResolvedValue({ id: 'ocr-2' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      const largeFile = makeFile({ size: 3 * 1024 * 1024, buffer: Buffer.concat([makePdfBuffer(), Buffer.alloc(3 * 1024 * 1024 - 8)]) })

      const result = await service.initiateUpload('tenant-1', 'user-1', largeFile, {})

      expect(result.status).toBe('pending')
      expect(mockProcessor.enqueue).toHaveBeenCalledOnce()
      expect(mockProcessor.processSync).not.toHaveBeenCalled()
    })

    it('rejects files exceeding 10MB', async () => {
      const oversized = makeFile({ size: 11 * 1024 * 1024 })
      await expect(
        service.initiateUpload('tenant-1', 'user-1', oversized, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects files with invalid magic bytes', async () => {
      const fake = makeFile({ buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]) })
      await expect(
        service.initiateUpload('tenant-1', 'user-1', fake, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects when OCR quota is exhausted', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: false, current: 10, limit: 10 })
      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('enforces tenant isolation — ocrRun created with correct tenantId', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockPrisma.ocrRun.create.mockResolvedValue({ id: 'ocr-3' })
      mockPrisma.auditEvent.create.mockResolvedValue({})
      mockProcessor.processSync.mockResolvedValue({
        fields: {}, confidence: 0.5, rawLlmPreview: '', warnings: [],
      })

      await service.initiateUpload('tenant-abc', 'user-1', makeFile(), {})

      expect(mockPrisma.ocrRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: 'tenant-abc' }),
        }),
      )
    })

    // ── P0-1: Storage rollback tests ──────────────────────────────────────────

    it('[P0-1] deletes file from storage when ocrRun.create() throws', async () => {
      const builtKey = 'tenants/tenant-1/ocr/2026-05/some-uuid.pdf'
      mockStorage.buildKey.mockReturnValue(builtKey)
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockStorage.delete.mockResolvedValue(undefined)
      mockPrisma.ocrRun.create.mockRejectedValue(new Error('DB connection timeout'))

      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow(BadRequestException)

      // Rollback must delete exactly the key that was built for this upload
      expect(mockStorage.delete).toHaveBeenCalledOnce()
      expect(mockStorage.delete).toHaveBeenCalledWith(builtKey)
    })

    it('[P0-1] throws BadRequestException (not original DB error) after storage rollback', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockStorage.delete.mockResolvedValue(undefined)
      mockPrisma.ocrRun.create.mockRejectedValue(new Error('P2002: Unique constraint'))

      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow('No se pudo registrar el documento.')
    })

    it('[P0-1] proceeds normally when rollback storage.delete() itself fails', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      // storage.delete throws — must not mask the original BadRequestException
      mockStorage.delete.mockRejectedValue(new Error('R2 delete unavailable'))
      mockPrisma.ocrRun.create.mockRejectedValue(new Error('DB timeout'))

      // Still throws the appropriate user-facing error, not the R2 error
      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('[P0-1] does NOT call storage.delete when upload itself fails (nothing to rollback)', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockRejectedValue(new Error('R2 unreachable'))

      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow(BadRequestException)

      expect(mockStorage.delete).not.toHaveBeenCalled()
    })
  })

  // ── getStatus ───────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns status for existing run owned by tenant', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', tenantId: 'tenant-1', status: 'processed',
        fileUrl: 'https://cdn.test/file.pdf', mimeType: 'application/pdf',
        fileSizeBytes: 51200, originalFileName: 'factura.pdf',
        fields: { vendor: 'ACME', total: 100000 },
        confidence: 0.9, errorMessage: null, retryCount: 0,
        processingStartedAt: new Date(), processingCompletedAt: new Date(),
        purchaseId: null, createdAt: new Date(), updatedAt: new Date(),
      })

      const result = await service.getStatus('tenant-1', 'ocr-1')

      expect(result.status).toBe('processed')
      expect(result.fields?.vendor).toBe('ACME')
    })

    it('throws NotFoundException for run belonging to another tenant', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue(null)

      await expect(service.getStatus('tenant-other', 'ocr-1'))
        .rejects.toThrow(NotFoundException)
    })

    it('queries with tenantId always included (tenant isolation)', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue(null)
      await service.getStatus('tenant-xyz', 'ocr-1').catch(() => {})

      expect(mockPrisma.ocrRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-xyz' }),
        }),
      )
    })
  })

  // ── retry ───────────────────────────────────────────────────────────────────

  describe('retry', () => {
    it('throws BadRequestException when run is already processed', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'processed', retryCount: 0, fileUrl: 'https://cdn.test/file.pdf',
        mimeType: 'application/pdf',
      })

      await expect(service.retry('tenant-1', 'user-1', 'ocr-1'))
        .rejects.toThrow(BadRequestException)
    })

    it('throws ForbiddenException when retry count exceeds 5', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'failed', retryCount: 5, fileUrl: 'https://cdn.test/file.pdf',
        mimeType: 'application/pdf',
      })

      await expect(service.retry('tenant-1', 'user-1', 'ocr-1'))
        .rejects.toThrow(ForbiddenException)
    })

    it('throws NotFoundException for unknown run', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue(null)
      await expect(service.retry('tenant-1', 'user-1', 'nonexistent'))
        .rejects.toThrow(NotFoundException)
    })
  })

  // ── delete ───────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes an existing processed run', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', tenantId: 'tenant-1', status: 'processed',
        fileUrl: 'https://cdn.test/file.pdf',
      })
      mockPrisma.ocrRun.delete.mockResolvedValue({})

      await service.delete('tenant-1', 'ocr-1')

      expect(mockPrisma.ocrRun.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ocr-1' } }),
      )
    })

    it('prevents deletion of runs currently processing', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'processing', fileUrl: 'https://cdn.test/file.pdf',
      })

      await expect(service.delete('tenant-1', 'ocr-1'))
        .rejects.toThrow(BadRequestException)
    })
  })
})

// ── OCR Schema tests ──────────────────────────────────────────────────────────

describe('detectMimeFromBuffer', () => {
  it('detects PDF from magic bytes', async () => {
    const { detectMimeFromBuffer } = await import('./ocr.schemas')
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('application/pdf')
    expect(result?.ext).toBe('pdf')
  })

  it('detects JPEG from magic bytes', async () => {
    const { detectMimeFromBuffer } = await import('./ocr.schemas')
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('image/jpeg')
  })

  it('detects PNG from magic bytes', async () => {
    const { detectMimeFromBuffer } = await import('./ocr.schemas')
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('image/png')
  })

  it('returns null for unknown buffer', async () => {
    const { detectMimeFromBuffer } = await import('./ocr.schemas')
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03])
    expect(detectMimeFromBuffer(buf)).toBeNull()
  })
})

describe('parseOcrLlmResponse', () => {
  it('parses valid LLM response correctly', async () => {
    const { parseOcrLlmResponse } = await import('./ocr.schemas')
    const raw = {
      vendor: 'Proveedor SAS',
      vendorNit: '900123456-7',
      invoiceNumber: 'FV-001',
      date: '2026-05-20',
      dueDate: null,
      currency: 'COP',
      items: [{
        description: 'Servicio de consultoría',
        quantity: 1,
        unitPrice: 100000,
        taxRate: 19,
        subtotal: 100000,
        taxAmount: 19000,
      }],
      subtotal: 100000,
      taxTotal: 19000,
      total: 119000,
      paymentMethod: null,
      notes: null,
      confidence: 0.95,
    }

    const result = parseOcrLlmResponse(raw)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.vendor).toBe('Proveedor SAS')
      expect(result.data.confidence).toBe(0.95)
      expect(result.data.items).toHaveLength(1)
    }
  })

  it('rejects non-object input', async () => {
    const { parseOcrLlmResponse } = await import('./ocr.schemas')
    expect(parseOcrLlmResponse('string')).toMatchObject({ success: false })
    expect(parseOcrLlmResponse(null)).toMatchObject({ success: false })
    expect(parseOcrLlmResponse([1, 2])).toMatchObject({ success: false })
  })

  it('clamps confidence to [0, 1]', async () => {
    const { parseOcrLlmResponse } = await import('./ocr.schemas')
    const result = parseOcrLlmResponse({ confidence: 5.5, items: [] })
    if (result.success) {
      expect(result.data.confidence).toBe(1)
    }
  })

  it('skips items without description', async () => {
    const { parseOcrLlmResponse } = await import('./ocr.schemas')
    const raw = {
      items: [
        { description: '', quantity: 1, unitPrice: 100 },
        { description: 'Válido', quantity: 2, unitPrice: 50 },
      ],
      confidence: 0.8,
    }
    const result = parseOcrLlmResponse(raw)
    if (result.success) {
      expect(result.data.items).toHaveLength(1)
      expect(result.data.items[0].description).toBe('Válido')
    }
  })
})

describe('extractJsonFromLlmText', () => {
  it('extracts JSON from markdown fence', async () => {
    const { extractJsonFromLlmText } = await import('./ocr.schemas')
    const text = 'Aquí está el resultado:\n```json\n{"vendor":"ACME","total":119000}\n```'
    const result = extractJsonFromLlmText(text)
    expect(result).toMatchObject({ vendor: 'ACME', total: 119000 })
  })

  it('extracts bare JSON object from prose', async () => {
    const { extractJsonFromLlmText } = await import('./ocr.schemas')
    const text = 'El documento contiene: {"vendor":"Test","total":50000} según el análisis.'
    const result = extractJsonFromLlmText(text)
    expect(result).toMatchObject({ vendor: 'Test' })
  })

  it('returns null when no JSON found', async () => {
    const { extractJsonFromLlmText } = await import('./ocr.schemas')
    expect(extractJsonFromLlmText('No hay JSON aquí')).toBeNull()
  })
})
