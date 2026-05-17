import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { QuoteStatus } from '@prisma/client'

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.quote.findMany({
      where: { tenantId },
      include: { client: true, items: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
      include: { client: true, items: true },
    })

    if (!quote) {
      throw new NotFoundException('Cotización no encontrada')
    }

    return quote
  }

  private async generateQuoteNumber(tx: any, tenantId: string): Promise<string> {
    const [row] = await tx.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "Quote"
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `
    return `CT-${String(Number(row.count) + 1).padStart(6, '0')}`
  }

  async create(tenantId: string, data: {
    clientId: string
    validUntil?: Date
    notes?: string
    terms?: string
    items: {
      productId: string
      quantity: number
      unitPrice: number
      taxRate: number
      notes?: string
    }[]
  }) {
    return this.prisma.$transaction(async (tx) => {
      const quoteNumber = await this.generateQuoteNumber(tx, tenantId)

      const subtotal = data.items.reduce((acc, item) => acc + (item.unitPrice * item.quantity), 0)
      const taxTotal = data.items.reduce((acc, item) => acc + (item.unitPrice * item.quantity * (item.taxRate / 100)), 0)
      const total = subtotal + taxTotal

      // Fetch product names
      const itemsWithNames = await Promise.all(
        data.items.map(async (item, index) => {
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          return {
            productId: item.productId,
            lineNumber: index + 1,
            productName: product?.name || 'Producto',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            subtotal: item.unitPrice * item.quantity,
            taxAmount: item.unitPrice * item.quantity * (item.taxRate / 100),
            notes: item.notes,
          }
        })
      )

      const quote = await tx.quote.create({
        data: {
          tenantId,
          clientId: data.clientId,
          number: quoteNumber,
          subtotal,
          taxTotal,
          total,
          validUntil: data.validUntil,
          notes: data.notes,
          terms: data.terms,
          status: QuoteStatus.draft,
          items: { create: itemsWithNames },
        },
        include: { items: true, client: true },
      })

      return quote
    })
  }

  async updateStatus(tenantId: string, id: string, status: QuoteStatus) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
    })

    if (!quote) {
      throw new NotFoundException('Cotización no encontrada')
    }

    if (quote.status === QuoteStatus.converted) {
      throw new BadRequestException('No se puede cambiar el estado de una cotización ya convertida')
    }

    return this.prisma.quote.update({
      where: { id },
      data: { status },
      include: { items: true, client: true },
    })
  }

  async convertToInvoice(tenantId: string, id: string, invoicesService: any) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
      include: { items: true, client: true },
    })

    if (!quote) {
      throw new NotFoundException('Cotización no encontrada')
    }

    if (quote.status === QuoteStatus.converted) {
      throw new BadRequestException('La cotización ya fue convertida a factura')
    }

    if (quote.status !== QuoteStatus.accepted) {
      throw new BadRequestException('Solo cotizaciones aceptadas pueden convertirse')
    }

    // invoicesService.create has its own $transaction — cannot nest
    const invoice = await invoicesService.create(tenantId, {
      clientId: quote.clientId!,
      paymentTermDays: 30,
      notes: `Convertido de cotización ${quote.number}. ${quote.notes || ''}`,
      items: quote.items.map(item => ({
        productId: item.productId!,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
      })),
    })

    await this.prisma.quote.update({
      where: { id },
      data: {
        status: QuoteStatus.converted,
        convertedToInvoiceId: invoice.id,
      },
    })

    return { quote: await this.findOne(tenantId, id), invoice }
  }

  async remove(tenantId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId },
    })

    if (!quote) {
      throw new NotFoundException('Cotización no encontrada')
    }

    if (quote.status === QuoteStatus.converted) {
      throw new BadRequestException('No se puede eliminar una cotización convertida')
    }

    return this.prisma.quote.delete({ where: { id } })
  }
}
