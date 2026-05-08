import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { InvoiceStatus } from '@prisma/client'

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.invoice.findMany({
      where: { tenantId },
      include: {
        client: true,
        items: true,
      },
      orderBy: { issuedAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: {
        client: true,
        items: true,
      },
    })

    if (!invoice) {
      throw new NotFoundException('Factura no encontrada')
    }

    return invoice
  }

  async create(tenantId: string, data: {
    clientId: string
    paymentTermDays: number
    notes?: string
    items: {
      productId: string
      quantity: number
      unitPrice: number
      taxRate: number
    }[]
  }) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Get Tenant to check stock settings
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) throw new NotFoundException('Tenant no encontrado')

      const subtotal = data.items.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0)
      const taxTotal = data.items.reduce((acc, item) => acc + (item.unitPrice * item.quantity * (item.taxRate / 100)), 0)
      const total = subtotal + taxTotal

      // 2. Create Invoice
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          clientId: data.clientId,
          paymentTermDays: data.paymentTermDays,
          notes: data.notes,
          subtotal,
          taxTotal,
          total,
          status: InvoiceStatus.emitted, // We emit immediately in this version
          items: {
            create: data.items.map((item, index) => ({
              productId: item.productId,
              lineNumber: index + 1,
              productName: 'Product Name', // Ideally fetch this from product table
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unitCost: 0, // Should fetch from product cost
              taxRate: item.taxRate,
              subtotal: item.unitPrice * item.quantity,
              taxAmount: item.unitPrice * item.quantity * (item.taxRate / 100),
            })),
          },
        },
        include: { items: true },
      })

      // 3. Update Stock and create Inventory Movements
      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } })
        if (!product) throw new NotFoundException(`Producto ${item.productId} no encontrado`)

        if (product.isInventoriable) {
          if (!tenant.allowNegativeStock && product.stock < item.quantity) {
            throw new BadRequestException(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Requerido: ${item.quantity}`)
          }

          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          })

          await tx.inventoryMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              productName: product.name,
              type: 'salida',
              quantity: item.quantity,
              reason: `Venta - Factura ${invoice.id}`,
              batch: '',
              note: `Descuento automático por factura ${invoice.id}`,
              referenceId: invoice.id,
              at: new Date(),
            },
          })
        }
      }

      return invoice
    })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    // Logic for cancelling/deleting and restoring stock could be added here
    return this.prisma.invoice.delete({
      where: { id },
    })
  }
}
