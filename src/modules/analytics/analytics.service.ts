import { Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardKpis(tenantId: string, from?: string, to?: string) {
    const whereInvoice: any = { tenantId, status: 'emitted' };
    if (from || to) {
      whereInvoice.issuedAt = {};
      if (from) whereInvoice.issuedAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        whereInvoice.issuedAt.lte = toDate;
      }
    }

    const [totalSales, stockStats, lowStockCount] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: whereInvoice,
        _sum: { total: true },
      }),
      this.prisma.product.aggregate({
        where: { tenantId },
        _sum: { stock: true },
      }),
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::int AS count FROM "Product"
        WHERE "tenantId" = ${tenantId}
          AND "isInventoriable" = true
          AND stock < "minStock"
      `,
    ])

    return {
      totalSales: totalSales._sum.total || 0,
      totalStockItems: stockStats._sum.stock || 0,
      lowStockAlerts: Number(lowStockCount[0]?.count ?? 0),
    }
  }

  async getSalesByMonth(tenantId: string) {
    const sales = await this.prisma.invoice.findMany({
      where: { tenantId, status: 'emitted' },
      select: { total: true, issuedAt: true },
    })

    // Group by month (simplified)
    const months: Record<string, number> = {}
    sales.forEach(s => {
      const month = s.issuedAt.toISOString().substring(0, 7) // YYYY-MM
      months[month] = (months[month] || 0) + Number(s.total)
    })

    return Object.entries(months).map(([name, total]) => ({ name, total }))
  }

  async exportInvoicesCsv(tenantId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId },
      include: { client: true },
      orderBy: { issuedAt: 'desc' },
    })

    const header = 'ID,Fecha,Cliente,Total,Estado\n'
    const rows = invoices.map(inv => 
      `${inv.id},${inv.issuedAt.toISOString()},${inv.client?.name || 'N/A'},${inv.total},${inv.status}`
    ).join('\n')

    return header + rows
  }

  async getSalesReport(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1)
    const toDate = to ? new Date(to) : new Date()

    const [invoices, previousPeriod] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          status: { not: 'cancelled' },
          issuedAt: { gte: fromDate, lte: toDate },
        },
        include: { client: true, items: true },
        orderBy: { issuedAt: 'desc' },
      }),
      this.prisma.invoice.aggregate({
        where: {
          tenantId,
          status: { not: 'cancelled' },
          issuedAt: {
            gte: new Date(fromDate.getTime() - (toDate.getTime() - fromDate.getTime())),
            lt: fromDate,
          },
        },
        _sum: { total: true },
        _count: true,
      }),
    ])

    const summary = {
      totalSales: invoices.reduce((sum, inv) => sum + Number(inv.total), 0),
      invoiceCount: invoices.length,
      averageInvoice: invoices.length > 0 
        ? invoices.reduce((sum, inv) => sum + Number(inv.total), 0) / invoices.length 
        : 0,
      totalTax: invoices.reduce((sum, inv) => sum + Number(inv.taxTotal), 0),
    }

    const previousTotal = Number(previousPeriod._sum.total || 0)
    const growth = previousTotal > 0 
      ? ((summary.totalSales - previousTotal) / previousTotal) * 100 
      : 0

    return {
      period: { from: fromDate, to: toDate },
      summary,
      growth: { percentage: growth, trend: growth >= 0 ? 'up' : 'down' },
      invoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.number,
        date: inv.issuedAt,
        client: inv.client?.name || 'N/A',
        total: Number(inv.total),
        status: inv.status,
        itemCount: inv.items.length,
      })),
    }
  }

  async getTopProducts(tenantId: string, limit: number = 10) {
    const items = await this.prisma.invoiceItem.findMany({
      where: {
        invoice: { tenantId, status: { not: 'cancelled' } },
      },
      select: {
        productId: true,
        productName: true,
        quantity: true,
        subtotal: true,
      },
    })

    const productMap = new Map()
    items.forEach(item => {
      const existing = productMap.get(item.productId) || {
        productId: item.productId,
        name: item.productName,
        totalQuantity: 0,
        totalRevenue: 0,
      }
      existing.totalQuantity += item.quantity
      existing.totalRevenue += Number(item.subtotal)
      productMap.set(item.productId, existing)
    })

    return Array.from(productMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit)
  }

  async getAggregates(tenantId: string, model: string, operation: '_sum' | '_avg' | '_count', field?: string, where: any = {}) {
    const prismaModel = (this.prisma as any)[model]
    if (!prismaModel) throw new Error(`Model ${model} not found`)

    const result = await prismaModel.aggregate({
      where: { ...where, tenantId },
      [operation]: field ? { [field]: true } : true,
    })

    return result;
  }

  /**
   * Retrieve real‑time alerts for the tenant.
   * Includes low‑stock product count and pending invoices.
   */
  async getAlerts(tenantId: string) {
    const lowStockCount = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::int AS count FROM "Product"
      WHERE "tenantId" = ${tenantId}
        AND "isInventoriable" = true
        AND stock < "minStock"
    `;
    const pendingInvoices = await this.prisma.invoice.count({
      where: {
        tenantId,
        status: { in: ['emitted', 'sent'] },
      },
    });
    const ocrRunsCount = await this.prisma.ocrRun.count({
      where: { tenantId },
    });
    return {
      lowStockAlerts: Number(lowStockCount[0]?.count ?? 0),
      pendingInvoices,
      ocrRunsCount,
    };
  }

  async getCashFlowTrend(tenantId: string) {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const transactions = await this.prisma.transaction.findMany({
      where: {
        tenantId,
        date: { gte: thirtyDaysAgo },
      },
      orderBy: { date: 'asc' },
    })

    const dates: string[] = []
    const dailyBalances: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      dates.push(dateStr)
      dailyBalances[dateStr] = 0
    }

    transactions.forEach(t => {
      const dateStr = t.date.toISOString().split('T')[0]
      if (dailyBalances[dateStr] !== undefined) {
        const amount = Number(t.amount)
        if (t.type === 'INCOME') {
          dailyBalances[dateStr] += amount
        } else {
          dailyBalances[dateStr] -= amount
        }
      }
    })

    let runningBalance = 0
    const historicalPoints = dates.map(dateStr => {
      runningBalance += dailyBalances[dateStr]
      return {
        date: dateStr,
        balance: runningBalance,
      }
    })

    let slope = 0
    if (historicalPoints.length > 1) {
      const lastPoints = historicalPoints.slice(-7)
      const n = lastPoints.length
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
      for (let i = 0; i < n; i++) {
        sumX += i
        sumY += lastPoints[i].balance
        sumXY += i * lastPoints[i].balance
        sumXX += i * i
      }
      const denominator = (n * sumXX - sumX * sumX)
      slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0
    }

    const projectedPoints = []
    let lastBalance = runningBalance
    for (let i = 1; i <= 15; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      lastBalance += slope + (Math.sin(i) * (slope * 0.1 || 50000))
      projectedPoints.push({
        date: dateStr,
        balance: Math.max(0, lastBalance),
      })
    }

    return {
      historical: historicalPoints,
      projected: projectedPoints,
    }
  }

  async getOcrRuns(tenantId: string) {
    return this.prisma.ocrRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async simulateOcrRun(tenantId: string) {
    const mockInvoices = [
      {
        source: 'factura_exito_1092.pdf',
        sourcePreview: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?w=300',
        confidence: 0.96,
        fields: {
          vendor: 'Almacenes Éxito S.A.',
          nit: '890.900.608-9',
          date: new Date().toISOString().split('T')[0],
          subtotal: 150000,
          tax: 28500,
          total: 178500,
          items: [
            { description: 'Papel Impresora Resma A4', qty: 5, price: 20000, total: 100000 },
            { description: 'Bolígrafos Gel Negro (Caja)', qty: 2, price: 25000, total: 50000 },
          ],
        },
      },
      {
        source: 'recibo_coordinadora_9918.png',
        sourcePreview: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=300',
        confidence: 0.91,
        fields: {
          vendor: 'Coordinadora Mercantil S.A.',
          nit: '890.901.233-1',
          date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          subtotal: 45000,
          tax: 8550,
          total: 53550,
          items: [
            { description: 'Envío de muestras comerciales nacional', qty: 1, price: 45000, total: 45000 },
          ],
        },
      },
      {
        source: 'factura_d1_332.pdf',
        sourcePreview: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300',
        confidence: 0.98,
        fields: {
          vendor: 'Koba Colombia S.A.S. (D1)',
          nit: '900.283.473-5',
          date: new Date(Date.now() - 172800000).toISOString().split('T')[0],
          subtotal: 82000,
          tax: 0,
          total: 82000,
          items: [
            { description: 'Café Molido Premium 500g', qty: 4, price: 12000, total: 48000 },
            { description: 'Azúcar Refinada 1kg', qty: 10, price: 3400, total: 34000 },
          ],
        },
      },
    ];

    const selected = mockInvoices[randomInt(mockInvoices.length)];

    return this.prisma.ocrRun.create({
      data: {
        tenantId,
        source: selected.source,
        sourcePreview: selected.sourcePreview,
        confidence: selected.confidence,
        fields: selected.fields,
      },
    });
  }

  async approveOcrRun(tenantId: string, id: string) {
    const ocrRun = await this.prisma.ocrRun.findUnique({
      where: { id, tenantId },
    });

    if (!ocrRun) throw new Error('OCR run not found');

    const fields = ocrRun.fields as any;
    const vendorName = fields.vendor || 'Proveedor OCR';
    const nit = fields.nit || '123456789-0';
    const total = Number(fields.total || 0);
    const subtotal = Number(fields.subtotal || total);
    const tax = Number(fields.tax || 0);

    let provider = await this.prisma.thirdParty.findFirst({
      where: { tenantId, nit, kind: 'provider' },
    });

    if (!provider) {
      provider = await this.prisma.thirdParty.create({
        data: {
          tenantId,
          name: vendorName,
          nit,
          email: `${vendorName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'proveedor'}@example.com`,
          kind: 'provider',
          phone: '3001234567',
          address: 'Dirección OCR',
          city: 'Bogotá',
          taxProfile: 'Persona Jurídica',
        },
      });
    }

    const nextNumber = 1000 + randomInt(9000);

    const purchase = await this.prisma.purchase.create({
      data: {
        tenantId,
        number: `CO-${nextNumber}`,
        providerId: provider.id,
        status: 'registered',
        subtotal,
        taxTotal: tax,
        total,
        notes: `Registrado automáticamente mediante OCR de IA (${ocrRun.source})`,
      },
    });

    await this.prisma.transaction.create({
      data: {
        tenantId,
        type: 'EXPENSE',
        amount: total,
        description: `Gasto de Compra ${purchase.number} (${provider.name})`,
        category: 'CAJA',
        reference: purchase.id,
      },
    });

    await this.prisma.ocrRun.delete({
      where: { id },
    });

    return purchase;
  }

  async deleteOcrRun(tenantId: string, id: string) {
    return this.prisma.ocrRun.delete({
      where: { id, tenantId },
    });
  }
}
