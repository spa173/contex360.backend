import { Controller, Get, UseGuards, Res } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { Response } from 'express'

@Controller('analytics')
@UseGuards(PermissionsGuard)
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
}
