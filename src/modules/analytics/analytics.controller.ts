import { Controller, Get, Post, Delete, Param, Query, UseGuards, Res } from '@nestjs/common'
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
  getDashboardKpis(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getDashboardKpis(tenantId, from, to);
  }

  @Get('alerts')
  @Permissions('view_reports')
  getAlerts(@TenantId() tenantId: string) {
    return this.analyticsService.getAlerts(tenantId);
  }

  @Get('cash-flow-trend')
  @Permissions('view_reports')
  getCashFlowTrend(@TenantId() tenantId: string) {
    return this.analyticsService.getCashFlowTrend(tenantId);
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
    return this.analyticsService.getTopProducts(tenantId, Number.parseInt(limit || '10', 10))
  }

  @Get('ocr-runs')
  @Permissions('run_ocr')
  getOcrRuns(@TenantId() tenantId: string) {
    return this.analyticsService.getOcrRuns(tenantId);
  }

  @Post('ocr-runs/simulate')
  @Permissions('run_ocr')
  simulateOcrRun(@TenantId() tenantId: string) {
    return this.analyticsService.simulateOcrRun(tenantId);
  }

  @Post('ocr-runs/:id/approve')
  @Permissions('run_ocr')
  approveOcrRun(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.analyticsService.approveOcrRun(tenantId, id);
  }

  @Delete('ocr-runs/:id')
  @Permissions('run_ocr')
  deleteOcrRun(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.analyticsService.deleteOcrRun(tenantId, id);
  }
}
