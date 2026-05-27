import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common'
import { TreasuryService } from './treasury.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { PlanGuard } from '../auth/plan.guard'
import { RequirePlanModule } from '../auth/plan.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { CreateTransactionDto } from './treasury.dto'

@Controller('treasury')
@UseGuards(AuthGuard, PermissionsGuard, PlanGuard)
@RequirePlanModule('treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Get()
  @Permissions('view_accounting')
  findAll(@TenantId() tenantId: string) {
    return this.treasuryService.findAll(tenantId)
  }

  @Get('balance')
  @Permissions('view_accounting')
  getBalance(@TenantId() tenantId: string) {
    return this.treasuryService.getBalance(tenantId)
  }

  @Post('transactions')
  @Permissions('manage_accounting')
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateTransactionDto,
  ) {
    return this.treasuryService.create(tenantId, dto)
  }
}
