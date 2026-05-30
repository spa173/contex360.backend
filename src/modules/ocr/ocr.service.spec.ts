import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { OcrService } from './ocr.service'
import { PrismaService } from '../database/prisma.service'
import { UsageService } from '../usage/usage.service'
import { OcrProcessor } from './ocr.processor'
import { STORAGE_PROVIDER } from '../../common/storage/storage.interface'
import { detectMimeFromBuffer, parseOcrLlmResponse, extractJsonFromLlmText, balancedJsonExtract } from './ocr.schemas'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  ocrRun: {
    create:     vi.fn(),
    findFirst:  vi.fn(),
    findMany:   vi.fn(),
    count:      vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),  // used by retry() CAS lock
    delete:     vi.fn(),
    groupBy:    vi.fn(),
    aggregate:  vi.fn(),
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

    it('[P0-3] async path passes fileUrl (not fileBuffer) to processor — avoids RAM retention', async () => {
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/large.pdf' })
      mockPrisma.ocrRun.create.mockResolvedValue({ id: 'ocr-large' })
      mockPrisma.auditEvent.create.mockResolvedValue({})

      const largeFile = makeFile({
        size:   3 * 1024 * 1024,
        buffer: Buffer.concat([makePdfBuffer(), Buffer.alloc(3 * 1024 * 1024 - 8)]),
      })

      await service.initiateUpload('tenant-1', 'user-1', largeFile, {})

      const enqueuedJob = mockProcessor.enqueue.mock.calls[0][0]
      // Async jobs must use fileUrl, not fileBuffer (P0-3: buffer GC after HTTP response)
      expect(enqueuedJob.fileUrl).toBe('https://cdn.test/large.pdf')
      expect(enqueuedJob.fileBuffer).toBeUndefined()
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

    // ── P1-1: retry() CAS optimistic lock tests ───────────────────────────

    it('[P1-1] retry() uses updateMany CAS with status condition before enqueuing', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'failed', retryCount: 1,
        fileUrl: 'https://cdn.test/file.pdf', mimeType: 'application/pdf',
      })
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 5, limit: 50 })
      mockPrisma.ocrRun.updateMany.mockResolvedValue({ count: 1 })  // lock acquired

      await service.retry('tenant-1', 'user-1', 'ocr-1')

      // CAS must use exact status from the read — prevents TOCTOU race
      expect(mockPrisma.ocrRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id:       'ocr-1',
            tenantId: 'tenant-1',
            status:   'failed',  // exact status from the read
          }),
          data: expect.objectContaining({ status: 'pending' }),
        }),
      )
    })

    it('[P1-1] retry() throws ConflictException when CAS returns count=0 (concurrent retry)', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'failed', retryCount: 0,
        fileUrl: 'https://cdn.test/file.pdf', mimeType: 'application/pdf',
      })
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      // Another concurrent request already changed the status
      mockPrisma.ocrRun.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.retry('tenant-1', 'user-1', 'ocr-1'))
        .rejects.toThrow(ConflictException)
    })

    it('[P1-1] successful retry enqueues with fileUrl (not fileBuffer) after CAS', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'failed', retryCount: 2,
        fileUrl: 'https://cdn.test/file.pdf', mimeType: 'application/pdf',
      })
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockPrisma.ocrRun.updateMany.mockResolvedValue({ count: 1 })

      await service.retry('tenant-1', 'user-1', 'ocr-1', true)

      expect(mockProcessor.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          ocrRunId:           'ocr-1',
          tenantId:           'tenant-1',
          fileUrl:            'https://cdn.test/file.pdf',
          autoCreatePurchase: true,
        }),
      )
      // fileBuffer must NOT be passed (P0-3: no RAM retention)
      const enqueuedJob = mockProcessor.enqueue.mock.calls[0][0]
      expect(enqueuedJob.fileBuffer).toBeUndefined()
    })

    it('[P1-1] retry() enforces tenant isolation in CAS condition', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', status: 'failed', retryCount: 0,
        fileUrl: 'https://cdn.test/file.pdf', mimeType: 'application/pdf',
      })
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockPrisma.ocrRun.updateMany.mockResolvedValue({ count: 1 })

      await service.retry('tenant-xyz', 'user-1', 'ocr-1')

      // tenantId must be in the CAS WHERE clause — prevents cross-tenant lock acquisition
      expect(mockPrisma.ocrRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-xyz' }),
        }),
      )
    })
  })

  // ── delete ───────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes an existing processed run', async () => {
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id: 'ocr-1', tenantId: 'tenant-1', status: 'processed',
        fileUrl: 'https://cdn.test/file.pdf',
        storageKey: null,
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
        storageKey: null,
      })

      await expect(service.delete('tenant-1', 'ocr-1'))
        .rejects.toThrow(BadRequestException)
    })

    // ── P1-2: storageKey as source of truth ──────────────────────────────────

    it('[P1-2] delete uses storageKey (not urlToKey) when storageKey is present', async () => {
      // Scenario: R2_PUBLIC_URL has a CDN subdirectory prefix.
      // The fileUrl path does NOT match the real R2 key — only storageKey is correct.
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id:         'ocr-1',
        tenantId:   'tenant-1',
        status:     'processed',
        fileUrl:    'https://files.contex360.com/cdn/tenants/t1/ocr/2026-05/uuid.pdf',
        storageKey: 'tenants/t1/ocr/2026-05/uuid.pdf',  // ← the real R2 key
      })
      mockPrisma.ocrRun.delete.mockResolvedValue({})
      mockStorage.delete.mockResolvedValue(undefined)

      await service.delete('tenant-1', 'ocr-1')

      // Must use storageKey — NOT the CDN path extracted from fileUrl
      expect(mockStorage.delete).toHaveBeenCalledWith('tenants/t1/ocr/2026-05/uuid.pdf')
      expect(mockStorage.delete).not.toHaveBeenCalledWith(
        expect.stringContaining('cdn/tenants'),
      )
    })

    it('[P1-2] delete falls back to urlToKey(fileUrl) for legacy records without storageKey', async () => {
      // Existing records before this migration have storageKey = null.
      // The fallback reconstructs the key from the URL pathname (only correct
      // when R2_PUBLIC_URL maps to the R2 bucket root without a prefix).
      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id:         'ocr-legacy',
        tenantId:   'tenant-1',
        status:     'processed',
        fileUrl:    'https://files.contex360.com/tenants/t1/ocr/2026-05/legacy.pdf',
        storageKey: null,  // ← legacy record: no storageKey persisted
      })
      mockPrisma.ocrRun.delete.mockResolvedValue({})
      mockStorage.delete.mockResolvedValue(undefined)

      await service.delete('tenant-1', 'ocr-legacy')

      // Fallback extracts pathname from URL (works when CDN root = R2 bucket root)
      expect(mockStorage.delete).toHaveBeenCalledWith(
        'tenants/t1/ocr/2026-05/legacy.pdf',
      )
    })

    it('[P1-2] delete prefers storageKey over urlToKey even when both would differ', async () => {
      // Proves that storageKey wins when the CDN URL would produce a different key
      const storageKey = 'tenants/t1/ocr/2026-05/correct-key.pdf'
      const wrongKeyFromUrl = 'cdn/tenants/t1/ocr/2026-05/correct-key.pdf'  // CDN prefix

      mockPrisma.ocrRun.findFirst.mockResolvedValue({
        id:         'ocr-1',
        tenantId:   'tenant-1',
        status:     'failed',
        fileUrl:    `https://files.contex360.com/${wrongKeyFromUrl}`,
        storageKey,
      })
      mockPrisma.ocrRun.delete.mockResolvedValue({})
      mockStorage.delete.mockResolvedValue(undefined)

      await service.delete('tenant-1', 'ocr-1')

      expect(mockStorage.delete).toHaveBeenCalledWith(storageKey)
      expect(mockStorage.delete).not.toHaveBeenCalledWith(wrongKeyFromUrl)
    })
  })

  // ── initiateUpload — storageKey persistence (P1-2) ─────────────────────────

  describe('initiateUpload — storageKey persistence (P1-2)', () => {
    it('[P1-2] persists storageKey in ocrRun.create at upload time', async () => {
      const expectedKey = 'tenants/tenant-1/ocr/2026-05/some-uuid.pdf'
      mockStorage.buildKey.mockReturnValue(expectedKey)
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockPrisma.ocrRun.create.mockResolvedValue({ id: 'ocr-new' })
      mockPrisma.auditEvent.create.mockResolvedValue({})
      mockProcessor.processSync.mockResolvedValue({
        fields: { vendor: 'Test', total: 1000 }, confidence: 0.9,
        purchaseId: undefined, rawLlmPreview: '{}', warnings: [],
      })

      await service.initiateUpload('tenant-1', 'user-1', makeFile(), {})

      // storageKey must be persisted in the create call
      expect(mockPrisma.ocrRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storageKey: expectedKey,
          }),
        }),
      )
    })

    it('[P1-2] P0-1 rollback uses storageKey (not fileUrl) when DB write fails', async () => {
      const expectedKey = 'tenants/tenant-1/ocr/2026-05/rollback-uuid.pdf'
      mockStorage.buildKey.mockReturnValue(expectedKey)
      mockUsage.checkLimit.mockResolvedValue({ allowed: true, current: 0, limit: 50 })
      mockStorage.upload.mockResolvedValue({ url: 'https://cdn.test/file.pdf' })
      mockStorage.delete.mockResolvedValue(undefined)
      mockPrisma.ocrRun.create.mockRejectedValue(new Error('DB timeout'))

      await expect(
        service.initiateUpload('tenant-1', 'user-1', makeFile(), {}),
      ).rejects.toThrow(BadRequestException)

      // Rollback must delete the exact storageKey, not a URL-derived key
      expect(mockStorage.delete).toHaveBeenCalledWith(expectedKey)
    })
  })
})

// ── OCR Schema tests ──────────────────────────────────────────────────────────

describe('detectMimeFromBuffer', () => {
  it('detects PDF from magic bytes', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('application/pdf')
    expect(result?.ext).toBe('pdf')
  })

  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('image/jpeg')
  })

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47])
    const result = detectMimeFromBuffer(buf)
    expect(result?.mime).toBe('image/png')
  })

  it('returns null for unknown buffer', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03])
    expect(detectMimeFromBuffer(buf)).toBeNull()
  })
})

describe('parseOcrLlmResponse', () => {
  it('parses valid LLM response correctly', () => {
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

  it('rejects non-object input', () => {
    expect(parseOcrLlmResponse('string')).toMatchObject({ success: false })
    expect(parseOcrLlmResponse(null)).toMatchObject({ success: false })
    expect(parseOcrLlmResponse([1, 2])).toMatchObject({ success: false })
  })

  it('clamps confidence to [0, 1]', () => {
    const result = parseOcrLlmResponse({ confidence: 5.5, items: [] })
    if (result.success) {
      expect(result.data.confidence).toBe(1)
    }
  })

  it('skips items without description', () => {
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

describe('extractJsonFromLlmText — markdown fence path (existing)', () => {
  it('extracts JSON from markdown fence', () => {
    const text = 'Aquí está el resultado:\n```json\n{"vendor":"ACME","total":119000}\n```'
    const result = extractJsonFromLlmText(text)
    expect(result).toMatchObject({ vendor: 'ACME', total: 119000 })
  })

  it('extracts bare JSON object from prose', () => {
    const text = 'El documento contiene: {"vendor":"Test","total":50000} según el análisis.'
    const result = extractJsonFromLlmText(text)
    expect(result).toMatchObject({ vendor: 'Test' })
  })

  it('returns null when no JSON found', () => {
    expect(extractJsonFromLlmText('No hay JSON aquí')).toBeNull()
  })
})

// ── P1-5: balancedJsonExtract — comprehensive parser tests ───────────────────

describe('balancedJsonExtract (P1-5 — brace-balancing parser)', () => {
  // Import both functions once for the describe block
  let extract = balancedJsonExtract
  let extractFull = extractJsonFromLlmText

  // ── Core correctness ───────────────────────────────────────────────────────

  it('extracts JSON from clean text with no surrounding content', () => {
    expect(extract('{"vendor":"ACME","total":119000}')).toMatchObject({
      vendor: 'ACME', total: 119000,
    })
  })

  it('[bug-fix] text + JSON + text (the lastIndexOf bug case)', () => {
    // This is the PRIMARY bug: lastIndexOf('}') would grab the } from "adjunto."
    // causing JSON.parse to fail on the concatenated string
    const text =
      'El documento fue procesado correctamente.\n' +
      '{"vendor":"Proveedor SAS","total":119000}\n' +
      'Nota: Los valores pueden estar en miles. Ver {formulario} adjunto.'
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'Proveedor SAS', total: 119000 })
  })

  it('[bug-fix] two consecutive JSON objects — returns the FIRST one', () => {
    // lastIndexOf would merge both objects into one unparseable string
    const text = '{"vendor":"ACME","total":100000} {"currency":"COP","note":"ver anexo"}'
    const result = extract(text)
    // Must return the FIRST complete JSON, not a merged/broken one
    expect(result).toMatchObject({ vendor: 'ACME' })
    expect((result as any).currency).toBeUndefined()
  })

  // ── Nested objects ─────────────────────────────────────────────────────────

  it('handles deeply nested JSON without corruption', () => {
    const text = '{"vendor":"ACME","address":{"city":"Bogotá","zip":"110111"},"total":50000}'
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'ACME', address: { city: 'Bogotá' } })
  })

  it('nested JSON preceded by prose', () => {
    const text =
      'Aquí están los datos extraídos: ' +
      '{"vendor":"Test S.A.","items":[{"desc":"Producto","qty":2}],"total":80000}'
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'Test S.A.', total: 80000 })
  })

  // ── Curly braces inside strings ───────────────────────────────────────────

  it('ignores { and } that appear inside string values', () => {
    const text = '{"notes":"ver {formulario} adjunto","total":1000}'
    const result = extract(text)
    expect(result).toMatchObject({ notes: 'ver {formulario} adjunto', total: 1000 })
  })

  it('multiple braces in string values followed by prose brace', () => {
    const text =
      '{"notes":"formato {A} y {B}","total":5000} ' +
      'El {estado} del documento es correcto.'
    const result = extract(text)
    expect(result).toMatchObject({ notes: 'formato {A} y {B}', total: 5000 })
  })

  it('handles escaped quotes inside strings without breaking string state', () => {
    const text = '{"vendor":"Empresa \\"Quoted\\" S.A.","total":200000}'
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'Empresa "Quoted" S.A.', total: 200000 })
  })

  it('handles double-backslash (\\\\) in string values', () => {
    // JSON string: {"path": "C:\\Users"} — raw chars include \\
    const text = '{"path":"C:\\\\Users","total":1000}'
    const result = extract(text)
    expect(result).toMatchObject({ path: 'C:\\Users', total: 1000 })
  })

  // ── Incomplete / malformed JSON ────────────────────────────────────────────

  it('returns null for incomplete JSON (no closing brace)', () => {
    expect(extract('{"vendor":"ACME","total":119000')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extract('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(extract('   \n\t  ')).toBeNull()
  })

  it('returns null for text with no JSON at all', () => {
    expect(extract('No hay JSON en este texto. Solo palabras.')).toBeNull()
  })

  it('skips invalid JSON (unquoted keys) and finds valid JSON that follows', () => {
    // LLM sometimes outputs non-standard JSON first, then corrects itself
    const text = '{tipo: "incorrecto", valor: 100} {"vendor":"ACME","total":50000}'
    const result = extract(text)
    // Should skip the invalid first block and return the valid second block
    expect(result).toMatchObject({ vendor: 'ACME', total: 50000 })
  })

  it('returns null when only invalid JSON exists (unquoted keys, no valid fallback)', () => {
    expect(extract('{tipo: "x", valor: 100}')).toBeNull()
  })

  // ── Real Gemini response patterns ─────────────────────────────────────────

  it('real pattern: JSON + multi-line disclaimer after', () => {
    // Gemini sometimes adds explanatory text after the JSON
    const text =
      '{"vendor":"Distribuidora ABC S.A.","vendorNit":"900123456-7",' +
      '"invoiceNumber":"FV-2026-001","total":238000,"confidence":0.92}\n\n' +
      'Nota: Los valores de IVA fueron calculados al 19%. ' +
      'El campo "confidence" refleja la calidad de la imagen. ' +
      'Si algún campo aparece como null, el texto no era legible.'
    const result = extract(text)
    expect(result).toMatchObject({
      vendor: 'Distribuidora ABC S.A.',
      vendorNit: '900123456-7',
      total: 238000,
      confidence: 0.92,
    })
  })

  it('real pattern: JSON preceded by explanation paragraph', () => {
    const text =
      'He analizado el documento y extraído los siguientes datos contables:\n\n' +
      '{"vendor":"Papelería Nacional","total":45000,"currency":"COP","items":[' +
      '{"description":"Resma papel A4","quantity":2,"unitPrice":22500}]}\n\n' +
      'El documento parece ser una factura de compra estándar.'
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'Papelería Nacional', total: 45000 })
  })

  it('real pattern: markdown fence with multi-line JSON', () => {
    const text =
      'Aquí está la extracción:\n' +
      '```json\n' +
      '{\n' +
      '  "vendor": "Empresa Test",\n' +
      '  "total": 119000,\n' +
      '  "confidence": 0.88\n' +
      '}\n' +
      '```'
    const result = extractFull(text)  // uses fence path
    expect(result).toMatchObject({ vendor: 'Empresa Test', total: 119000 })
  })

  it('real pattern: fence with invalid JSON falls through to brace parser', () => {
    // If the fence content is invalid, fall through to balancedJsonExtract
    const text =
      '```json\n{invalid content here}\n```\n' +
      'Sin embargo, los datos reales son: {"vendor":"ACME","total":50000}'
    const result = extractFull(text)
    // Fence parse fails → falls through → brace parser finds the second JSON
    expect(result).toMatchObject({ vendor: 'ACME', total: 50000 })
  })

  // ── Determinism guarantee ─────────────────────────────────────────────────

  it('is deterministic — same input always produces same output', () => {
    const text = 'Texto {"vendor":"Test","total":100} más texto {"vendor":"Other","total":200}'
    const r1 = extract(text)
    const r2 = extract(text)
    const r3 = extract(text)
    expect(r1).toEqual(r2)
    expect(r2).toEqual(r3)
    expect((r1 as any).vendor).toBe('Test')  // always the FIRST complete JSON
  })

  it('two identical JSON objects — always returns first one', () => {
    const json = '{"vendor":"X","total":100}'
    const text = `${json} some prose ${json}`
    const result = extract(text)
    expect(result).toMatchObject({ vendor: 'X', total: 100 })
    // Both are valid; deterministically returns first
  })
})
