import { Test, TestingModule } from '@nestjs/testing'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { Response } from 'express'

import { PrismaService } from '../database/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

describe('AnalyticsController', () => {
  let controller: AnalyticsController
  let service: AnalyticsService

  const mockAnalyticsService = {
    getDashboardKpis: vi.fn().mockResolvedValue({ sales: 100 }),
    getSalesByMonth: vi.fn().mockResolvedValue([{ month: 'Jan' }]),
    exportInvoicesCsv: vi.fn().mockResolvedValue('id,total\n1,100')
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: Reflector, useValue: {} },
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
      ],
    }).compile()

    controller = module.get<AnalyticsController>(AnalyticsController)
    service = module.get<AnalyticsService>(AnalyticsService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call getDashboardKpis', async () => {
    const res = await controller.getDashboardKpis('t1')
    expect(res).toEqual({ sales: 100 })
    expect(service.getDashboardKpis).toHaveBeenCalledWith('t1')
  })

  it('should call getSalesByMonth', async () => {
    const res = await controller.getSalesByMonth('t1')
    expect(res).toEqual([{ month: 'Jan' }])
    expect(service.getSalesByMonth).toHaveBeenCalledWith('t1')
  })

  it('should call exportInvoices', async () => {
    const mockRes = {
      header: vi.fn(),
      attachment: vi.fn(),
      send: vi.fn().mockReturnValue('sent')
    } as unknown as Response
    
    const res = await controller.exportInvoices('t1', mockRes)
    expect(mockRes.header).toHaveBeenCalledWith('Content-Type', 'text/csv')
    expect(mockRes.attachment).toHaveBeenCalled()
    expect(mockRes.send).toHaveBeenCalledWith('id,total\n1,100')
    expect(res).toBe('sent')
  })
})
