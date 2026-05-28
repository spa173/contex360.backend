import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { InvoiceStatus } from '@prisma/client'
import { UsageService } from '../usage/usage.service'

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly usageService: UsageService,
  ) {}

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

  private async generateInvoiceNumber(tx: any, tenantId: string): Promise<string> {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { lastInvoiceNumber: { increment: 1 } },
      select: { invoicePrefix: true, lastInvoiceNumber: true }
    }) as any
    return `${tenant.invoicePrefix}-${String(tenant.lastInvoiceNumber).padStart(6, '0')}`
  }

  async getNextNumber(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { invoicePrefix: true, lastInvoiceNumber: true } as any
    }) as any
    if (!tenant) throw new NotFoundException('Tenant no encontrado')
    const nextNumber = Number(tenant.lastInvoiceNumber || 0) + 1
    return {
      prefix: tenant.invoicePrefix || 'FV',
      nextNumber,
      preview: `${tenant.invoicePrefix || 'FV'}-${String(nextNumber).padStart(6, '0')}`
    }
  }

  async create(tenantId: string, data: {
    clientId: string
    paymentTermDays: number
    notes?: string
    items: {
      productId: string
      quantity: number
      unitPrice: number
    }[]
  }) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Get Tenant to check stock settings
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) throw new NotFoundException('Tenant no encontrado')

      // 1.5 Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber(tx, tenantId)

// Subtotal, taxTotal and total are calculated after fetching product tax rates

      // 2. Calculate due date
      const issuedAt = new Date()
      const dueAt = new Date(issuedAt)
      dueAt.setDate(dueAt.getDate() + (data.paymentTermDays || 30))

      // 3. Pre-fetch all products to resolve names and costs
      const productMap = new Map<string, any>()
      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } })
        if (!product) throw new NotFoundException(`Producto ${item.productId} no encontrado`)
        productMap.set(item.productId, product)
      }

      // Compute subtotal and taxes based on product tax rates
      const subtotal = data.items.reduce((acc, item) => {
        return acc + (item.unitPrice * item.quantity);
      }, 0);
      const taxTotal = data.items.reduce((acc, item) => {
        const product = productMap.get(item.productId);
        const taxRate = Number(product.taxRate || 0);
        return acc + (item.unitPrice * item.quantity * (taxRate / 100));
      }, 0);
      const total = subtotal + taxTotal;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          clientId: data.clientId,
          number: invoiceNumber,
          paymentTermDays: data.paymentTermDays,
          dueAt,
          notes: data.notes,
          subtotal,
          taxTotal,
          total,
          status: InvoiceStatus.emitted,
          items: {
            create: data.items.map((item, index) => {
              const product = productMap.get(item.productId)
              return {
                productId: item.productId,
                lineNumber: index + 1,
                productName: product.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitCost: Number(product.cost),
                taxRate: Number(product.taxRate || 0),
                subtotal: item.unitPrice * item.quantity,
                taxAmount: item.unitPrice * item.quantity * (Number(product.taxRate || 0) / 100),
              }
            }),
          },
        },
        include: { items: true },
      })

      // 4. Update Stock and create Inventory Movements
      for (const item of data.items) {
        const product = productMap.get(item.productId)

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

      // 5. Update Subscription Usage
      await tx.subscription.updateMany({
        where: { tenantId },
        data: { invoicesThisMonth: { increment: 1 } },
      })

      // 5b. Record usage metric
      await this.usageService.recordUsage(tenantId, 'invoice_created')

      // 6. Create Ledger Entry
      const clientName = (await tx.thirdParty.findUnique({ where: { id: data.clientId } }))?.name || 'Cliente Genérico'
      await this.ledger.create(tenantId, {
        referenceType: 'invoice',
        referenceId: invoice.id,
        description: `Factura ${invoice.number} - ${clientName}`,
        amount: total,
        lines: [
          { account: '130505', label: 'Clientes nacionales', debit: total, credit: 0 },
          { account: '413595', label: 'Ingresos operacionales', debit: 0, credit: subtotal },
          { account: '240805', label: 'IVA generado', debit: 0, credit: taxTotal }
        ]
      }, tx)

      return invoice
    })
  }

  async updateStatus(tenantId: string, id: string, status: InvoiceStatus) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, tenantId },
        include: { client: true, items: true },
      })

      if (!invoice) throw new NotFoundException('Factura no encontrada')

      const updated = await tx.invoice.update({
        where: { id },
        data: { status },
        include: { items: true },
      })

      if (status === InvoiceStatus.accepted) {
        await this.ledger.create(tenantId, {
          referenceType: 'payment_in',
          referenceId: id,
          description: `Cobro Factura ${invoice.number || id}`,
          amount: Number(invoice.total),
          lines: [
            { account: '110505', label: 'Caja general', debit: Number(invoice.total), credit: 0 },
            { account: '130505', label: 'Clientes nacionales', debit: 0, credit: Number(invoice.total) },
          ],
        }, tx)
      }

      return updated
    })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    return this.prisma.invoice.delete({
      where: { id },
    })
  }

  async cancel(tenantId: string, id: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Find invoice with items
      const invoice = await tx.invoice.findFirst({
        where: { id, tenantId },
        include: { items: true },
      })

      if (!invoice) {
        throw new NotFoundException('Factura no encontrada')
      }

      if (invoice.status === InvoiceStatus.cancelled) {
        throw new BadRequestException('La factura ya está cancelada')
      }

      // 2. Update invoice status
      const cancelledInvoice = await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.cancelled,
          notes: reason ? `${invoice.notes || ''}\n[CANCELADA: ${reason}]` : invoice.notes,
        },
        include: { items: true },
      })

      // 3. Reverse inventory for each item
      for (const item of invoice.items) {
        if (!item.productId) continue

        const product = await tx.product.findUnique({
          where: { id: item.productId },
        })

        if (!product || !product.isInventoriable) continue

        // Restore stock
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        })

        // Create reversal inventory movement
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            productName: product.name,
            type: 'entrada',
            quantity: item.quantity,
            reason: `Reversión - Cancelación Factura ${invoice.number || invoice.id}`,
            batch: '',
            note: reason || `Cancelación de factura ${invoice.number || invoice.id}`,
            referenceId: invoice.id,
            at: new Date(),
          },
        })
      }

      return cancelledInvoice
    })
  }

  async getOverdue(tenantId: string) {
    const now = new Date()
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { not: 'cancelled' },
        dueAt: { lt: now },
      },
      include: { client: true },
      orderBy: { dueAt: 'asc' },
    })

    const totalOverdue = invoices.reduce((sum, inv) => sum + Number(inv.total), 0)

    return {
      totalOverdue,
      invoiceCount: invoices.length,
      invoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.number,
        client: inv.client?.name || 'N/A',
        total: Number(inv.total),
        dueAt: inv.dueAt,
        daysOverdue: Math.floor((now.getTime() - new Date(inv.dueAt!).getTime()) / (1000 * 60 * 60 * 24)),
      })),
    }
  }

  async getAging(tenantId: string) {
    const now = new Date()
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        status: { not: 'cancelled' },
      },
      include: { client: true },
    })

    const buckets = {
      current: { label: 'Al día', days: 0, invoices: [] as any[], total: 0 },
      bucket1: { label: '1-30 días', days: 30, invoices: [] as any[], total: 0 },
      bucket2: { label: '31-60 días', days: 60, invoices: [] as any[], total: 0 },
      bucket3: { label: '61-90 días', days: 90, invoices: [] as any[], total: 0 },
      bucket4: { label: '90+ días', days: Infinity, invoices: [] as any[], total: 0 },
    }

    for (const inv of invoices) {
      if (!inv.dueAt) continue
      const daysOverdue = Math.floor((now.getTime() - new Date(inv.dueAt).getTime()) / (1000 * 60 * 60 * 24))
      const total = Number(inv.total)

      const invoiceData = {
        id: inv.id,
        number: inv.number,
        client: inv.client?.name || 'N/A',
        total,
        dueAt: inv.dueAt,
        daysOverdue,
      }

      if (daysOverdue <= 0) {
        buckets.current.invoices.push(invoiceData)
        buckets.current.total += total
      } else if (daysOverdue <= 30) {
        buckets.bucket1.invoices.push(invoiceData)
        buckets.bucket1.total += total
      } else if (daysOverdue <= 60) {
        buckets.bucket2.invoices.push(invoiceData)
        buckets.bucket2.total += total
      } else if (daysOverdue <= 90) {
        buckets.bucket3.invoices.push(invoiceData)
        buckets.bucket3.total += total
      } else {
        buckets.bucket4.invoices.push(invoiceData)
        buckets.bucket4.total += total
      }
    }

    return {
      totalPortfolio: Object.values(buckets).reduce((sum, b) => sum + b.total, 0),
      totalOverdue: buckets.bucket1.total + buckets.bucket2.total + buckets.bucket3.total + buckets.bucket4.total,
      buckets: [
        { ...buckets.current, count: buckets.current.invoices.length },
        { ...buckets.bucket1, count: buckets.bucket1.invoices.length },
        { ...buckets.bucket2, count: buckets.bucket2.invoices.length },
        { ...buckets.bucket3, count: buckets.bucket3.invoices.length },
        { ...buckets.bucket4, count: buckets.bucket4.invoices.length },
      ],
    }
  }
}
