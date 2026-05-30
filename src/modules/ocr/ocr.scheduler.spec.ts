import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { OcrScheduler } from './ocr.scheduler'
import { PrismaService } from '../database/prisma.service'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  ocrRun: {
    findMany: vi.fn(),
    update:   vi.fn(),
  },
  auditEvent: { create: vi.fn() },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStuckRun(override: Record<string, unknown> = {}) {
  const stuckAt = new Date(Date.now() - 15 * 60 * 1000) // 15 min ago — past 10 min threshold
  return {
    id:         'ocr-stuck-1',
    tenantId:   'tenant-1',
    status:     'processing',
    retryCount: 0,
    updatedAt:  stuckAt,
    ...override,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OcrScheduler.recoverStuckJobs', () => {
  let scheduler: OcrScheduler

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma.auditEvent.create.mockResolvedValue({})
    mockPrisma.ocrRun.update.mockResolvedValue({})

    const module = await Test.createTestingModule({
      providers: [
        OcrScheduler,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    scheduler = module.get(OcrScheduler)
  })

  it('does nothing when no stuck runs found', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([])

    await scheduler.recoverStuckJobs()

    expect(mockPrisma.ocrRun.update).not.toHaveBeenCalled()
  })

  it('[P0-2] resets stuck run to pending when retryCount < MAX_AUTO_RETRIES', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([makeStuckRun({ retryCount: 0 })])

    await scheduler.recoverStuckJobs()

    expect(mockPrisma.ocrRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ocr-stuck-1' },
        data: expect.objectContaining({
          status:     'pending',
          retryCount: { increment: 1 },
        }),
      }),
    )
  })

  it('[P0-2] marks run as failed when retryCount >= MAX_AUTO_RETRIES (2)', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([makeStuckRun({ retryCount: 2 })])

    await scheduler.recoverStuckJobs()

    expect(mockPrisma.ocrRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ocr-stuck-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    )
  })

  it('[P0-2] handles mix of runs — some reset, some failed', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([
      makeStuckRun({ id: 'ocr-1', retryCount: 0 }),
      makeStuckRun({ id: 'ocr-2', retryCount: 1 }),
      makeStuckRun({ id: 'ocr-3', retryCount: 2 }),  // exhausted → failed
    ])

    await scheduler.recoverStuckJobs()

    const updateCalls = mockPrisma.ocrRun.update.mock.calls

    const pendingUpdates = updateCalls.filter(c => c[0]?.data?.status === 'pending')
    const failedUpdates  = updateCalls.filter(c => c[0]?.data?.status === 'failed')

    expect(pendingUpdates).toHaveLength(2)  // ocr-1 and ocr-2
    expect(failedUpdates).toHaveLength(1)   // ocr-3
  })

  it('[P0-2] queries only runs older than the stuck threshold', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([])

    await scheduler.recoverStuckJobs()

    const query = mockPrisma.ocrRun.findMany.mock.calls[0][0]
    expect(query.where.status).toEqual({ in: ['processing', 'pending'] })
    expect(query.where.updatedAt.lt).toBeInstanceOf(Date)

    // The cutoff must be in the past (at least 9 minutes ago)
    const nineMinutesAgo = new Date(Date.now() - 9 * 60 * 1000)
    expect(query.where.updatedAt.lt.getTime()).toBeLessThan(nineMinutesAgo.getTime())
  })

  it('[P0-2] does NOT throw when prisma.ocrRun.findMany fails', async () => {
    mockPrisma.ocrRun.findMany.mockRejectedValue(new Error('DB connection lost'))

    // Cron must never propagate exceptions
    await expect(scheduler.recoverStuckJobs()).resolves.toBeUndefined()
  })

  it('[P0-2] does NOT throw when individual run update fails — top-level try/catch absorbs it', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([makeStuckRun()])
    mockPrisma.ocrRun.update.mockRejectedValue(new Error('Update conflict'))

    // Per §21 backend-execution-rules: cron must never propagate exceptions.
    // The top-level try/catch in recoverStuckJobs() absorbs all errors.
    await expect(scheduler.recoverStuckJobs()).resolves.toBeUndefined()
  })

  it('[P0-2] handles audit event creation failure gracefully', async () => {
    mockPrisma.ocrRun.findMany.mockResolvedValue([makeStuckRun()])
    mockPrisma.auditEvent.create.mockRejectedValue(new Error('Audit persist error'))

    await expect(scheduler.recoverStuckJobs()).resolves.toBeUndefined()
  })
})
