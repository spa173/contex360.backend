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
      this.prisma.product.count({
        where: {
          tenantId,
          isInventoriable: true,
          stock: { lt: this.prisma.product.fields.minStock },
        },
      }),
    ])

    return {
      totalSales: totalSales._sum.total || 0,
      totalStockItems: stockStats._sum.stock || 0,
      lowStockAlerts: lowStockCount,
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
}
