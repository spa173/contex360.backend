import { Test } from '@nestjs/testing'
import { ProductsService } from './products.service'
import { PrismaService } from '../database/prisma.service'
import { describe, expect, it, beforeEach, vi } from 'vitest'

describe('ProductsService', () => {
  let service: ProductsService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'p1' }),
        create: vi.fn().mockResolvedValue({ id: 'p2' }),
      },
    }

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get<ProductsService>(ProductsService)
  })

  it('findAll calls prisma', async () => {
    await service.findAll('t1')
    expect(prisma.product.findMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } })
  })

  it('findOne calls prisma', async () => {
    await service.findOne('id1', 't1')
    expect(prisma.product.findFirst).toHaveBeenCalled()
  })

  it('create calls prisma', async () => {
    await service.create({ name: 'Prod' }, 't1')
    expect(prisma.product.create).toHaveBeenCalled()
  })
})
