import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { QuotesService } from './quotes.service'
import { InvoicesService } from '../invoices/invoices.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { PlanGuard } from '../auth/plan.guard'
import { RequirePlanModule } from '../auth/plan.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { CreateQuoteDto, UpdateQuoteStatusDto } from './quotes.dto'

@Controller('quotes')
@UseGuards(AuthGuard, PermissionsGuard, PlanGuard)
@RequirePlanModule('billing')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get()
  @Permissions('view_billing')
  findAll(@TenantId() tenantId: string) {
    return this.quotesService.findAll(tenantId)
  }

  @Get(':id')
  @Permissions('view_billing')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.quotesService.findOne(tenantId, id)
  }

  @Post()
  @Permissions('manage_billing')
  create(
    @TenantId() tenantId: string,
    @Body() data: CreateQuoteDto,
  ) {
    return this.quotesService.create(tenantId, {
      ...data,
      validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
    })
  }

  @Patch(':id/status')
  @Permissions('manage_billing')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateQuoteStatusDto,
  ) {
    return this.quotesService.updateStatus(tenantId, id, body.status)
  }

  @Post(':id/convert')
  @Permissions('manage_billing')
  convertToInvoice(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.quotesService.convertToInvoice(tenantId, id, this.invoicesService)
  }

  @Delete(':id')
  @Permissions('manage_billing')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.quotesService.remove(tenantId, id)
  }
}
