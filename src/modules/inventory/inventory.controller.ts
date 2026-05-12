import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { InventoryMovementType } from '@prisma/client'

@Controller('inventory')
@UseGuards(PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('movements')
  @Permissions('view_inventory')
  findAllMovements(@TenantId() tenantId: string, @Query('productId') productId?: string) {
    return this.inventoryService.findAllMovements(tenantId, productId)
  }

  @Post('movements')
  @Permissions('manage_inventory')
  createMovement(
    @TenantId() tenantId: string,
    @Body() data: {
      productId: string
      type: InventoryMovementType
      quantity: number
      reason: string
      batch?: string
      note?: string
    },
  ) {
    return this.inventoryService.createMovement(tenantId, data)
  }

  @Get('kardex/:productId')
  @Permissions('view_inventory')
  getKardex(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.inventoryService.getKardex(tenantId, productId)
  }
}
