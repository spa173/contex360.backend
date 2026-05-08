import { Test, TestingModule } from '@nestjs/testing'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'

import { PrismaService } from '../database/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

describe('InventoryController', () => {
  let controller: InventoryController
  let service: InventoryService

  const mockInventoryService = {
    findAllMovements: vi.fn().mockResolvedValue([{ id: 'm1' }]),
    createMovement: vi.fn().mockResolvedValue({ id: 'm2' })
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: Reflector, useValue: {} },
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
      ],
    }).compile()

    controller = module.get<InventoryController>(InventoryController)
    service = module.get<InventoryService>(InventoryService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call findAllMovements without query', async () => {
    const res = await controller.findAllMovements('t1')
    expect(res).toEqual([{ id: 'm1' }])
    expect(service.findAllMovements).toHaveBeenCalledWith('t1', undefined)
  })

  it('should call findAllMovements with query', async () => {
    const res = await controller.findAllMovements('t1', 'p1')
    expect(res).toEqual([{ id: 'm1' }])
    expect(service.findAllMovements).toHaveBeenCalledWith('t1', 'p1')
  })

  it('should call createMovement', async () => {
    const res = await controller.createMovement('t1', { productId: 'p1' } as any)
    expect(res).toEqual({ id: 'm2' })
    expect(service.createMovement).toHaveBeenCalledWith('t1', { productId: 'p1' })
  })
})
