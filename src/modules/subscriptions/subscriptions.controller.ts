import { Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, UseGuards, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { WompiService } from './wompi.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

interface CheckoutDto {
  planType: 'starter' | 'pyme' | 'enterprise';
  billing: 'monthly' | 'annual';
}

interface WompiWebhookDto {
  data: any;
  signature?: { checksum?: string; properties?: string[] };
  timestamp?: number;
}

@Controller('subscriptions')
@UseGuards(AuthGuard, PermissionsGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
  ) {}

  @Get('current')
  getCurrent(@TenantId() tenantId: string) {
    return this.subscriptionsService.getCurrentSubscription(tenantId);
  }

  @Get('usage')
  getUsage(@TenantId() tenantId: string) {
    return this.subscriptionsService.getUsage(tenantId);
  }

  @Post('checkout')
  async checkout(@TenantId() tenantId: string, @Body() dto: CheckoutDto) {
    const { planType, billing } = dto;
    if (!planType || !billing) {
      throw new BadRequestException('Missing planType or billing');
    }
    const link = await this.wompiService.createPaymentLink(planType, billing, tenantId);
    // Wompi returns "url" for redirection
    const redirectUrl = link?.url || link?.checkout_url || link?.redirect_url;
    return { redirectUrl };
  }

  @Post('wompi-webhook')
  @HttpCode(HttpStatus.OK)
  async wompiWebhook(@Headers('x-wompi-signature') signature: string, @Body() body: WompiWebhookDto) {
    // Verify webhook signature
    const valid = this.wompiService.verifyWebhook(signature, body);
    if (!valid) {
      throw new BadRequestException('Invalid webhook signature');
    }

    // Only handle transaction.updated events with APPROVED status
    if (body?.data?.type !== 'transaction.updated' || body.data?.status !== 'APPROVED') {
      return { received: true };
    }

    const sku = body.data?.sku;
    if (!sku) return { received: true };

    const [planType, billing, tenantId] = sku.split('_');
    
    // Calculate renewsAt
    const renewsAt = new Date();
    if (billing === 'annual') {
      renewsAt.setDate(renewsAt.getDate() + 365);
    } else {
      renewsAt.setDate(renewsAt.getDate() + 30);
    }

    // Activate or update subscription in DB
    await this.subscriptionsService['prisma'].subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planType: planType as any,
        active: true,
        trialEndsAt: null,
        renewsAt,
        invoicesThisMonth: 0,
      },
      update: {
        active: true,
        planType: planType as any,
        trialEndsAt: null,
        renewsAt,
      },
    });
    return { received: true };
  }
}
