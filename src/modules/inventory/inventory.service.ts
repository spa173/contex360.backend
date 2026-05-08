import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { InventoryMovementType } from '@prisma/client'

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllMovements(tenantId: string, productId?: string) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        tenantId,
        ...(productId ? { productId } : {}),
      },
      orderBy: { at: 'desc' },
      include: { product: true },
    })
  }

  async createMovement(tenantId: string, data: {
    productId: string
    type: InventoryMovementType
    quantity: number
    reason: string
    batch?: string
    note?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: data.productId } })
      if (!product) throw new NotFoundException('Producto no encontrado')

      // Update Stock
      await tx.product.update({
        where: { id: data.productId },
        data: {
          stock: data.type === 'entrada' 
            ? { increment: data.quantity } 
            : { decrement: data.quantity },
        },
      })

      // Create Movement
      return tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: data.productId,
          productName: product.name,
          type: data.type,
          quantity: data.quantity,
          reason: data.reason,
          batch: data.batch || '',
          note: data.note || '',
          at: new Date(),
        },
      })
    })
  }

  async getKardex(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    })

    if (!product) throw new NotFoundException('Producto no encontrado')

    const movements = await this.findAllMovements(tenantId, productId)
    
    return {
      product,
      movements,
      currentStock: product.stock,
    }
  }
}
