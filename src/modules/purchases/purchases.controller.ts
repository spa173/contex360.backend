import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { PurchasesService } from './purchases.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('purchases')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @Permissions('view_billing')
  findAll(@TenantId() tenantId: string) {
    return this.purchasesService.findAll(tenantId)
  }

  @Get('next-number')
  @Permissions('view_billing')
  getNextNumber(@TenantId() tenantId: string) {
    return this.purchasesService.getNextNumber(tenantId)
  }

  @Get(':id')
  @Permissions('view_billing')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchasesService.findOne(tenantId, id)
  }

  @Post()
  @Permissions('manage_billing')
  create(
    @TenantId() tenantId: string,
    @Body()
    data: {
      providerId: string
      paymentTermDays: number
      notes?: string
      items: {
        productId: string
        productName: string
        quantity: number
        unitPrice: number
        taxRate: number
      }[]
    },
  ) {
    return this.purchasesService.create(tenantId, data)
  }

  @Patch(':id/status')
  @Permissions('manage_billing')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.purchasesService.updateStatus(tenantId, id, body.status as any)
  }

  @Delete(':id')
  @Permissions('manage_billing')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchasesService.remove(tenantId, id)
  }
}
