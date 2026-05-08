import { Test } from '@nestjs/testing'
import { InventoryService } from './inventory.service'
import { PrismaService } from '../database/prisma.service'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'

describe('InventoryService', () => {
  let service: InventoryService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      inventoryMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'mov-1' }),
      },
      product: {
        findUnique: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
    }

    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get<InventoryService>(InventoryService)
  })

  it('findAllMovements calls prisma findMany', async () => {
    await service.findAllMovements('tenant-1', 'prod-1')
    expect(prisma.inventoryMovement.findMany).toHaveBeenCalled()
  })

  it('createMovement updates stock and creates record', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Test Prod' })
    
    await service.createMovement('tenant-1', {
      productId: 'prod-1',
      type: 'entrada',
      quantity: 10,
      reason: 'Compra',
    })
    
    expect(prisma.product.update).toHaveBeenCalled()
    expect(prisma.inventoryMovement.create).toHaveBeenCalled()
  })

  it('getKardex throws if product not found', async () => {
    prisma.product.findFirst.mockResolvedValue(null)
    await expect(service.getKardex('tenant-1', 'none')).rejects.toThrow(NotFoundException)
  })
})
