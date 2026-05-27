import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { PurchasesService } from './purchases.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { PlanGuard } from '../auth/plan.guard'
import { RequirePlanModule } from '../auth/plan.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { CreatePurchaseDto, UpdatePurchaseStatusDto } from './purchases.dto'

@Controller('purchases')
@UseGuards(AuthGuard, PermissionsGuard, PlanGuard)
@RequirePlanModule('billing')
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
    @Body() data: CreatePurchaseDto,
  ) {
    return this.purchasesService.create(tenantId, data)
  }

  @Patch(':id/status')
  @Permissions('manage_billing')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseStatusDto,
  ) {
    return this.purchasesService.updateStatus(tenantId, id, body.status as any)
  }

  @Delete(':id')
  @Permissions('manage_billing')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchasesService.remove(tenantId, id)
  }
}
