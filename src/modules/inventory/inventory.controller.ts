import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthUser } from '../../common/decorators/auth-user.decorator'
import { CreateMovementDto, TransferStockDto, AuditInventoryDto, ReceiveInventoryDto } from './inventory.dto'

@Controller('inventory')
@UseGuards(AuthGuard, PermissionsGuard)
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
    @Body() data: CreateMovementDto,
    @AuthUser('id') userId: string
  ) {
    return this.inventoryService.createMovement(tenantId, { ...data, userId })
  }

  @Get('kardex/:productId')
  @Permissions('view_inventory')
  getKardex(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.inventoryService.getKardex(tenantId, productId)
  }

  // --- Transactions ---

  @Post('transfer')
  @Permissions('manage_inventory')
  transferStock(
    @TenantId() tenantId: string,
    @Body() payload: TransferStockDto,
    @AuthUser('id') userId: string
  ) {
    return this.inventoryService.transferStock(tenantId, { ...payload, userId })
  }

  @Post('receive-transfer/:transferId')
  @Permissions('manage_inventory')
  receiveTransfer(
    @TenantId() tenantId: string,
    @Param('transferId') transferId: string,
    @AuthUser('id') userId: string
  ) {
    return this.inventoryService.receiveTransfer(tenantId, transferId, userId)
  }

  @Post('audit')
  @Permissions('manage_inventory')
  auditInventory(
    @TenantId() tenantId: string,
    @Body() body: AuditInventoryDto,
    @AuthUser('id') userId: string
  ) {
    return this.inventoryService.auditInventory(tenantId, body.adjustments, userId)
  }

  @Post('receive')
  @Permissions('manage_inventory')
  receiveInventory(
    @TenantId() tenantId: string,
    @Body() payload: ReceiveInventoryDto,
    @AuthUser('id') userId: string
  ) {
    return this.inventoryService.receiveInventory(tenantId, { ...payload, userId })
  }

  // --- Analytics ---

  @Get('analytics/dead')
  @Permissions('view_inventory')
  getDeadInventory(@TenantId() tenantId: string) {
    return this.inventoryService.getDeadInventory(tenantId)
  }

  @Get('analytics/reorder')
  @Permissions('view_inventory')
  getReorderSuggestions(@TenantId() tenantId: string) {
    return this.inventoryService.getReorderSuggestions(tenantId)
  }

  @Get('analytics/abc')
  @Permissions('view_inventory')
  getAbcAnalysis(@TenantId() tenantId: string) {
    return this.inventoryService.getAbcAnalysis(tenantId)
  }
}
