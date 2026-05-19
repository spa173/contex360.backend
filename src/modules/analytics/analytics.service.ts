import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardKpis(tenantId: string) {
    const [totalSales, stockStats, lowStockCount] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { tenantId, status: 'emitted' },
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
    return {
      lowStockAlerts: Number(lowStockCount[0]?.count ?? 0),
      pendingInvoices,
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
}
