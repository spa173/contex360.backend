import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { InvoicesService } from './invoices.service'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('invoices')
@UseGuards(PermissionsGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Permissions('manage_billing')
  findAll(@TenantId() tenantId: string) {
    return this.invoicesService.findAll(tenantId)
  }

  @Get(':id')
  @Permissions('manage_billing')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.findOne(tenantId, id)
  }

  @Post()
  @Permissions('manage_billing')
  create(
    @TenantId() tenantId: string,
    @Body() data: {
      clientId: string
      paymentTermDays: number
      notes?: string
      items: {
        productId: string
        quantity: number
        unitPrice: number
        taxRate: number
      }[]
    },
  ) {
    return this.invoicesService.create(tenantId, data)
  }

  @Delete(':id')
  @Permissions('manage_billing')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.remove(tenantId, id)
  }
}
