import { Controller, Get, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

@Controller('subscriptions')
@UseGuards(AuthGuard, PermissionsGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('current')
  getCurrent(@TenantId() tenantId: string) {
    return this.subscriptionsService.getCurrentSubscription(tenantId);
  }
}
