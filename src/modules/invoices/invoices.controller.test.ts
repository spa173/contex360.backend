import { Test, TestingModule } from '@nestjs/testing'
import { InvoicesController } from './invoices.controller'
import { InvoicesService } from './invoices.service'

import { PrismaService } from '../database/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

describe('InvoicesController', () => {
  let controller: InvoicesController
  let service: InvoicesService

  const mockInvoicesService = {
    findAll: vi.fn().mockResolvedValue([{ id: 'i1' }]),
    findOne: vi.fn().mockResolvedValue({ id: 'i2' }),
    create: vi.fn().mockResolvedValue({ id: 'i3' }),
    remove: vi.fn().mockResolvedValue({ id: 'i4' })
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: Reflector, useValue: {} },
        {
          provide: InvoicesService,
          useValue: mockInvoicesService,
        },
      ],
    }).compile()

    controller = module.get<InvoicesController>(InvoicesController)
    service = module.get<InvoicesService>(InvoicesService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call findAll', async () => {
    const res = await controller.findAll('t1')
    expect(res).toEqual([{ id: 'i1' }])
    expect(service.findAll).toHaveBeenCalledWith('t1')
  })

  it('should call findOne', async () => {
    const res = await controller.findOne('t1', 'i2')
    expect(res).toEqual({ id: 'i2' })
    expect(service.findOne).toHaveBeenCalledWith('t1', 'i2')
  })

  it('should call create', async () => {
    const res = await controller.create('t1', { total: 100 } as any)
    expect(res).toEqual({ id: 'i3' })
    expect(service.create).toHaveBeenCalledWith('t1', { total: 100 })
  })

  it('should call remove', async () => {
    const res = await controller.remove('t1', 'i4')
    expect(res).toEqual({ id: 'i4' })
    expect(service.remove).toHaveBeenCalledWith('t1', 'i4')
  })
})
