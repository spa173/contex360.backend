import { Test } from '@nestjs/testing'
import { OcrController } from './ocr.controller'
import { OcrService } from './ocr.service'
import { BadRequestException } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('OcrController', () => {
  let controller: OcrController
  const mockOcrService = {
    initiateUpload: vi.fn(),
    list: vi.fn(),
    getStats: vi.fn(),
    getStatus: vi.fn(),
    retry: vi.fn(),
    delete: vi.fn(),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await Test.createTestingModule({
      controllers: [OcrController],
      providers: [
        { provide: OcrService, useValue: mockOcrService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get(OcrController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should delegate list to service', async () => {
    mockOcrService.list.mockResolvedValue({ data: [], total: 0 })
    const result = await controller.list('tenant-1', { page: 1, limit: 10 })
    expect(mockOcrService.list).toHaveBeenCalledWith('tenant-1', { page: 1, limit: 10 })
    expect(result).toEqual({ data: [], total: 0 })
  })

  it('should delegate getStats to service', async () => {
    mockOcrService.getStats.mockResolvedValue({ total: 5 })
    const result = await controller.getStats('tenant-1')
    expect(mockOcrService.getStats).toHaveBeenCalledWith('tenant-1')
    expect(result).toEqual({ total: 5 })
  })

  it('should delegate getOne to service', async () => {
    mockOcrService.getStatus.mockResolvedValue({ status: 'pending' })
    const result = await controller.getOne('tenant-1', 'run-1')
    expect(mockOcrService.getStatus).toHaveBeenCalledWith('tenant-1', 'run-1')
    expect(result).toEqual({ status: 'pending' })
  })

  it('should delegate retry to service', async () => {
    mockOcrService.retry.mockResolvedValue({ ocrRunId: 'run-1', status: 'pending' })
    const result = await controller.retry('tenant-1', { sub: 'user-1' } as any, 'run-1', { autoCreatePurchase: true })
    expect(mockOcrService.retry).toHaveBeenCalledWith('tenant-1', 'user-1', 'run-1', true)
    expect(result).toEqual({ ocrRunId: 'run-1', status: 'pending' })
  })

  it('should delegate delete to service', async () => {
    mockOcrService.delete.mockResolvedValue(undefined)
    await controller.delete('tenant-1', 'run-1')
    expect(mockOcrService.delete).toHaveBeenCalledWith('tenant-1', 'run-1')
  })

  it('should throw BadRequestException if no file is provided in upload', async () => {
    expect(() => controller.upload('tenant-1', { sub: 'user-1' } as any, undefined as any, {})).toThrow(BadRequestException)
  })

  it('should delegate upload to service when file is provided', async () => {
    const file = { size: 100, mimetype: 'application/pdf', originalname: 'test.pdf' } as any
    mockOcrService.initiateUpload.mockResolvedValue({ ocrRunId: 'run-1', status: 'processed' })
    const result = await controller.upload('tenant-1', { sub: 'user-1' } as any, file, { autoCreatePurchase: true })
    expect(mockOcrService.initiateUpload).toHaveBeenCalledWith('tenant-1', 'user-1', file, { autoCreatePurchase: true })
    expect(result).toEqual({ ocrRunId: 'run-1', status: 'processed' })
  })
})
