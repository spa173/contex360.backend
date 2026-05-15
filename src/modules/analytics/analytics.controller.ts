import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import type { Response } from 'express'

@Controller('analytics')
@UseGuards(AuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Permissions('view_reports')
  getDashboardKpis(@TenantId() tenantId: string) {
    return this.analyticsService.getDashboardKpis(tenantId)
  }

  @Get('sales-by-month')
  @Permissions('view_reports')
  getSalesByMonth(@TenantId() tenantId: string) {
    return this.analyticsService.getSalesByMonth(tenantId)
  }

  @Get('export/invoices')
  @Permissions('view_reports')
  async exportInvoices(@TenantId() tenantId: string, @Res() res: Response) {
    const csv = await this.analyticsService.exportInvoicesCsv(tenantId)
    res.header('Content-Type', 'text/csv')
    res.attachment(`facturas-${tenantId}-${Date.now()}.csv`)
    return res.send(csv)
  }

  @Get('sales-report')
  @Permissions('view_reports')
  getSalesReport(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getSalesReport(tenantId, from, to)
  }

  @Get('top-products')
  @Permissions('view_reports')
  getTopProducts(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getTopProducts(tenantId, parseInt(limit || '10'))
  }
}
