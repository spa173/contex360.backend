import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
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
    referenceId?: string
    attachmentUrl?: string
    userId?: string
  }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: data.productId } })
      if (!product) throw new NotFoundException('Producto no encontrado')

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { allowNegativeStock: true } })

      if (data.type === 'salida' && !tenant?.allowNegativeStock && product.stock < data.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Requerido: ${data.quantity}`
        )
      }

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
          referenceId: data.referenceId,
          attachmentUrl: data.attachmentUrl,
          userId: data.userId,
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

  async transferStock(tenantId: string, payload: { productId: string, fromLocId: string, toLocId: string, quantity: number, userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: payload.productId, tenantId } })
      if (!product || !product.isInventoriable) throw new BadRequestException('Producto invalido')

      const stockByLocation = (product.stockByLocation as Record<string, number>) || {}
      const locStock = stockByLocation[payload.fromLocId] || 0
      
      if (locStock < payload.quantity) throw new BadRequestException('Stock insuficiente en bodega origen')

      // Update stock
      stockByLocation[payload.fromLocId] -= payload.quantity
      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: { decrement: payload.quantity },
          stockByLocation: stockByLocation as any,
        }
      })

      // Create Transfer
      const transfer = await tx.inventoryTransfer.create({
        data: {
          tenantId,
          productId: product.id,
          fromLocId: payload.fromLocId,
          toLocId: payload.toLocId,
          quantity: payload.quantity,
          status: 'en_transito',
        } as any
      })

      // Create Movement (Salida)
      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: product.id,
          productName: product.name,
          type: 'salida',
          quantity: payload.quantity,
          reason: 'traslado_salida',
          batch: '',
          note: `Despacho a ${payload.toLocId}`,
          userId: payload.userId,
        }
      })

      return transfer
    })
  }

  async receiveTransfer(tenantId: string, transferId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.inventoryTransfer.findFirst({ where: { id: transferId, tenantId } })
      if (!transfer || transfer.status !== 'en_transito') throw new BadRequestException('Traslado no valido')

      const product = await tx.product.findUnique({ where: { id: (transfer as any).productId } })
      if (!product) throw new BadRequestException('Producto no encontrado')

      const stockByLocation = (product.stockByLocation as Record<string, number>) || {}
      stockByLocation[transfer.toLocId] = (stockByLocation[transfer.toLocId] || 0) + transfer.quantity

      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: { increment: transfer.quantity },
          stockByLocation: stockByLocation as any,
        }
      })

      const updatedTransfer = await tx.inventoryTransfer.update({
        where: { id: transferId },
        data: {
          status: 'completado',
          receivedAt: new Date(),
        }
      })

      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: product.id,
          productName: product.name,
          type: 'entrada',
          quantity: transfer.quantity,
          reason: 'traslado_entrada',
          batch: '',
          note: `Recepcion desde ${transfer.fromLocId}`,
          userId,
        }
      })

      return updatedTransfer
    })
  }

  async auditInventory(tenantId: string, adjustments: any[], userId?: string) {
    let totalAdjustments = 0
    await this.prisma.$transaction(async (tx) => {
      for (const adj of adjustments) {
        const product = await tx.product.findUnique({ where: { id: adj.productId, tenantId } })
        if (!product || !product.isInventoriable) continue

        const stockByLocation = (product.stockByLocation as Record<string, number>) || {}
        const currentLocStock = stockByLocation[adj.locationId] || 0
        const diff = adj.physicalCount - currentLocStock

        if (diff !== 0) {
          stockByLocation[adj.locationId] = adj.physicalCount
          
          await tx.product.update({
            where: { id: product.id },
            data: {
              stock: { increment: diff }, // diff can be negative
              stockByLocation: stockByLocation as any,
            }
          })

          await tx.inventoryMovement.create({
            data: {
              tenantId,
              productId: product.id,
              productName: product.name,
              type: diff > 0 ? 'entrada' : 'salida',
              quantity: Math.abs(diff),
              reason: 'ajuste_auditoria',
              batch: '',
              note: adj.reason || 'Ajuste fisico',
              attachmentUrl: adj.photoBase64 || '',
              userId,
            }
          })
          totalAdjustments++
        }
      }
    })
    return { ok: true, message: `Auditoria completada. ${totalAdjustments} ajustes.` }
  }

  async receiveInventory(tenantId: string, payload: { productId: string, quantity: number, unitCost: number, locId: string, userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: payload.productId, tenantId } })
      if (!product || !product.isInventoriable) throw new BadRequestException('Producto no valido')

      const oldTotalValue = Number(product.stock) * Number(product.cost)
      const newTotalValue = payload.quantity * payload.unitCost
      const newStock = product.stock + payload.quantity
      
      let newCost = Number(product.cost)
      if (newStock > 0) {
        newCost = (oldTotalValue + newTotalValue) / newStock
      }

      const stockByLocation = (product.stockByLocation as Record<string, number>) || {}
      stockByLocation[payload.locId] = (stockByLocation[payload.locId] || 0) + payload.quantity

      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: newStock,
          cost: newCost,
          stockByLocation: stockByLocation as any,
        }
      })

      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: product.id,
          productName: product.name,
          type: 'entrada',
          quantity: payload.quantity,
          reason: 'compra',
          batch: '',
          note: `Ingreso a ${payload.locId}`,
          userId: payload.userId,
        }
      })
      
      return { ok: true }
    })
  }

  async getDeadInventory(tenantId: string) {
    const now = new Date()
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    
    const products = await this.prisma.product.findMany({
      where: { tenantId, isInventoriable: true, productType: { not: 'kit' } }
    })

    const dead = []
    for (const p of products) {
      const lastMovement = await this.prisma.inventoryMovement.findFirst({
        where: { tenantId, productId: p.id, type: 'salida' },
        orderBy: { at: 'desc' }
      })
      
      if (!lastMovement) {
        dead.push(p)
      } else if (lastMovement.at < ninetyDaysAgo) {
        dead.push(p)
      }
    }
    return dead
  }

  async getReorderSuggestions(tenantId: string) {
    const products = await this.prisma.product.findMany({
      where: { 
        tenantId, 
        isInventoriable: true, 
        productType: { not: 'kit' },
      }
    })

    const suggestions = products
      .filter(p => p.stock <= p.minStock && p.maxStock > 0)
      .map(p => ({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        minStock: p.minStock,
        maxStock: p.maxStock,
        quantityToOrder: p.maxStock - p.stock,
        preferredSupplier: 'Sin Proveedor'
      }))

    return suggestions.reduce((acc, curr) => {
      const sup = curr.preferredSupplier
      if (!acc[sup]) acc[sup] = []
      acc[sup].push(curr)
      return acc
    }, {} as Record<string, any[]>)
  }

  async getAbcAnalysis(tenantId: string) {
    const sales = await this.prisma.invoiceItem.findMany({
      where: { invoice: { tenantId } },
    })

    const revenueByProduct: Record<string, number> = {}
    sales.forEach(item => {
      if (item.productId) {
        revenueByProduct[item.productId] = (revenueByProduct[item.productId] || 0) + Number(item.subtotal)
      }
    })

    const totalRevenue = Object.values(revenueByProduct).reduce((a, b) => a + b, 0)
    if (totalRevenue === 0) return {}

    const sorted = Object.entries(revenueByProduct).sort((a, b) => b[1] - a[1])
    
    let accum = 0
    const abc: Record<string, string> = {}
    sorted.forEach(([prodId, rev]) => {
      accum += rev
      const pct = accum / totalRevenue
      if (pct <= 0.8) abc[prodId] = 'A'
      else if (pct <= 0.95) abc[prodId] = 'B'
      else abc[prodId] = 'C'
    })
    return abc
  }
}
