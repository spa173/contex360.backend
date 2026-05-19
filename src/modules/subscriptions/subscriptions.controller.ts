import { Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
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
  type?: string;
  event?: string;
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
    if (!tenantId) {
      throw new ForbiddenException('Tenant requerido para crear el checkout.');
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
    const eventType = body?.type || body?.event || body?.data?.event || body?.data?.type
    const transactionStatus =
      body?.data?.transaction?.status ||
      body?.data?.status ||
      body?.data?.transaction?.final_status ||
      body?.data?.transaction?.result?.status

    if (eventType !== 'transaction.updated' || transactionStatus !== 'APPROVED') {
      return { received: true };
    }

    const sku =
      body.data?.sku ||
      body.data?.reference ||
      body.data?.transaction?.sku ||
      body.data?.transaction?.reference ||
      body.data?.transaction?.metadata?.sku;
    if (!sku) return { received: true };

    const [planType, billing, tenantId] = sku.split('_');
    
    // Calculate renewsAt
    const renewsAt = new Date();
    if (billing === 'annual') {
      renewsAt.setDate(renewsAt.getDate() + 365);
    } else {
      renewsAt.setDate(renewsAt.getDate() + 30);
    }

    await this.subscriptionsService.activateSubscription(
      tenantId,
      planType as any,
      billing as any,
      renewsAt,
    );
    return { received: true };
  }

  @Post('cancel')
  async cancel(@TenantId() tenantId: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant requerido para cancelar la suscripcion.');
    }
    await this.subscriptionsService.cancelSubscription(tenantId);
    return { ok: true, message: 'Suscripcion cancelada. Se mantendra activa hasta el final del ciclo actual.' };
  }
}
