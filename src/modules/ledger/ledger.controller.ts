import { Controller, Get, Patch, Post, Body, Param, UseGuards } from '@nestjs/common'
import { LedgerService, CreateLedgerEntryDto } from './ledger.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('ledger')
@UseGuards(AuthGuard, PermissionsGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @Permissions('view_accounting')
  findAll(@TenantId() tenantId: string) {
    return this.ledgerService.findAll(tenantId)
  }

  @Get('unreconciled')
  @Permissions('view_accounting')
  findUnreconciled(@TenantId() tenantId: string) {
    return this.ledgerService.findUnreconciled(tenantId)
  }

  @Patch(':id/reconcile')
  @Permissions('manage_accounting')
  reconcile(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.ledgerService.reconcileEntry(tenantId, id)
  }

  @Post()
  @Permissions('manage_accounting')
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateLedgerEntryDto,
  ) {
    return this.ledgerService.create(tenantId, dto)
  }
}
