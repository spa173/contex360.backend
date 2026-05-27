import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { InvoicesService } from './invoices.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { PlanGuard } from '../auth/plan.guard'
import { RequirePlanModule, CheckPlanLimit } from '../auth/plan.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { CreateInvoiceDto, UpdateInvoiceStatusDto, CancelInvoiceDto } from './invoices.dto'

@Controller('invoices')
@UseGuards(AuthGuard, PermissionsGuard, PlanGuard)
@RequirePlanModule('billing')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Permissions('view_billing')
  findAll(@TenantId() tenantId: string) {
    return this.invoicesService.findAll(tenantId)
  }

  @Get('next-number')
  @Permissions('view_billing')
  getNextNumber(@TenantId() tenantId: string) {
    return this.invoicesService.getNextNumber(tenantId)
  }

  @Get('overdue')
  @Permissions('view_billing')
  getOverdue(@TenantId() tenantId: string) {
    return this.invoicesService.getOverdue(tenantId)
  }

  @Get('aging')
  @Permissions('view_billing')
  getAging(@TenantId() tenantId: string) {
    return this.invoicesService.getAging(tenantId)
  }

  @Get(':id')
  @Permissions('view_billing')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.findOne(tenantId, id)
  }

  @Post()
  @Permissions('manage_billing')
  @CheckPlanLimit('maxInvoicesPerMonth')
  create(
    @TenantId() tenantId: string,
    @Body() data: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(tenantId, data)
  }

  @Patch(':id/status')
  @Permissions('manage_billing')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
    return this.invoicesService.updateStatus(tenantId, id, body.status)
  }

  @Delete(':id')
  @Permissions('manage_billing')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.remove(tenantId, id)
  }

  @Post(':id/cancel')
  @Permissions('manage_billing')
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: CancelInvoiceDto,
  ) {
    return this.invoicesService.cancel(tenantId, id, body.reason)
  }
}
