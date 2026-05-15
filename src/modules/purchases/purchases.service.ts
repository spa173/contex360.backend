import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { PurchaseStatus } from '@prisma/client'

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.purchase.findMany({
      where: { tenantId },
      include: {
        provider: true,
        items: true,
      },
      orderBy: { issuedAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, tenantId },
      include: {
        provider: true,
        items: true,
      },
    })

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada')
    }

    return purchase
  }

  private async generatePurchaseNumber(tx: any, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { lastPurchaseNumber: { increment: 1 } },
      select: { purchasePrefix: true, lastPurchaseNumber: true },
    })
    return `${tenant.purchasePrefix}-${String(tenant.lastPurchaseNumber).padStart(6, '0')}`
  }

  async getNextNumber(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { purchasePrefix: true, lastPurchaseNumber: true },
    })
    if (!tenant) throw new NotFoundException('Tenant no encontrado')
    const nextNumber = tenant.lastPurchaseNumber + 1
    return {
      prefix: tenant.purchasePrefix,
      nextNumber,
      preview: `${tenant.purchasePrefix}-${String(nextNumber).padStart(6, '0')}`,
    }
  }

  async create(
    tenantId: string,
    data: {
      providerId: string
      paymentTermDays: number
      notes?: string
      items: {
        productId: string
        productName: string
        quantity: number
        unitPrice: number
        taxRate: number
      }[]
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const purchaseNumber = await this.generatePurchaseNumber(tx, tenantId)

      const subtotal = data.items.reduce(
        (acc, item) => acc + item.unitPrice * item.quantity,
        0,
      )
      const taxTotal = data.items.reduce(
        (acc, item) =>
          acc + item.unitPrice * item.quantity * (item.taxRate / 100),
        0,
      )
      const total = subtotal + taxTotal

      // 1. Create Purchase
      const purchase = await tx.purchase.create({
        data: {
          tenantId,
          number: purchaseNumber,
          providerId: data.providerId,
          paymentTermDays: data.paymentTermDays,
          notes: data.notes,
          subtotal,
          taxTotal,
          total,
          status: PurchaseStatus.registered,
          items: {
            create: data.items.map((item, index) => ({
              productId: item.productId,
              lineNumber: index + 1,
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxRate: item.taxRate,
              subtotal: item.unitPrice * item.quantity,
              taxAmount:
                item.unitPrice * item.quantity * (item.taxRate / 100),
            })),
          },
        },
        include: { items: true },
      })

      // 2. Increase stock for inventoriable products (goods receipt)
      for (const item of data.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        })
        if (!product) continue

        if (product.isInventoriable) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          })

          await tx.inventoryMovement.create({
            data: {
              tenantId,
              productId: item.productId,
              productName: product.name,
              type: 'entrada',
              quantity: item.quantity,
              reason: `Compra - Documento ${purchase.id}`,
              batch: '',
              note: `Ingreso automático por compra ${purchase.id}`,
              referenceId: purchase.id,
              at: new Date(),
            },
          })
        }
      }

      // 3. Create accounting ledger entry
      // Debit: Gastos / Cuentas por pagar (total)
      // Debit: IVA descontable (taxTotal)
      // Credit: Proveedores (total)
      const providerName =
        (
          await tx.thirdParty.findUnique({
            where: { id: data.providerId },
          })
        )?.name ?? 'Proveedor'

      await this.ledger.create(tenantId, {
        referenceType: 'purchase',
        referenceId: purchase.id,
        description: `Compra ${purchase.id} - ${providerName}`,
        amount: total,
        lines: [
          {
            account: '510000',
            label: 'Gastos operacionales de compra',
            debit: subtotal,
            credit: 0,
          },
          {
            account: '240810',
            label: 'IVA descontable',
            debit: taxTotal,
            credit: 0,
          },
          {
            account: '220500',
            label: 'Proveedores nacionales',
            debit: 0,
            credit: total,
          },
        ],
      })

      return purchase
    })
  }

  async updateStatus(tenantId: string, id: string, status: PurchaseStatus) {
    const purchase = await this.findOne(tenantId, id)

    const updated = await this.prisma.purchase.update({
      where: { id },
      data: { status },
      include: { items: true },
    })

    // When marked as paid, create cash-payment ledger entry
    if (status === PurchaseStatus.paid) {
      await this.ledger.create(tenantId, {
        referenceType: 'payment_out',
        referenceId: id,
        description: `Pago Compra ${purchase.number || id}`,
        amount: Number(purchase.total),
        lines: [
          {
            account: '220500',
            label: 'Proveedores nacionales',
            debit: Number(purchase.total),
            credit: 0,
          },
          {
            account: '110505',
            label: 'Caja general',
            debit: 0,
            credit: Number(purchase.total),
          },
        ],
      })
    }

    return updated
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    return this.prisma.purchase.delete({ where: { id } })
  }
}
