import { Injectable, Logger, Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { WompiService } from './wompi.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { CheckoutDto, WompiWebhookDto } from './subscriptions.dto';
import { PLANS } from './plans.config';
import { PrismaService } from '../database/prisma.service';

@Controller('subscriptions')
@UseGuards(AuthGuard, PermissionsGuard)
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('current')
  getCurrent(@TenantId() tenantId: string) {
    return this.subscriptionsService.getCurrentSubscription(tenantId);
  }

  @Get('usage')
  getUsage(@TenantId() tenantId: string) {
    return this.subscriptionsService.getUsage(tenantId);
  }

  @Get('payments')
  async getPayments(@TenantId() tenantId: string) {
    return this.subscriptionsService.getPaymentHistory(tenantId);
  }

  @Get('invoices')
  async getInvoices(@TenantId() tenantId: string) {
    return this.subscriptionsService.getInvoiceHistory(tenantId);
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
    const redirectUrl = link?.url || link?.checkout_url || link?.redirect_url;
    return { redirectUrl };
  }

  @Post('wompi-webhook')
  @HttpCode(HttpStatus.OK)
  async wompiWebhook(@Headers('x-wompi-signature') signature: string, @Body() body: WompiWebhookDto) {
    this.logger.log('Webhook Wompi recibido');

    const valid = this.wompiService.verifyWebhook(signature, body);
    if (!valid) {
      this.logger.warn('Firma de webhook inválida');
      throw new BadRequestException('Invalid webhook signature');
    }

    const eventType = body?.type || body?.event || body?.data?.event || body?.data?.type;
    const transactionStatus =
      body?.data?.transaction?.status ||
      body?.data?.status ||
      body?.data?.transaction?.final_status ||
      body?.data?.transaction?.result?.status;

    this.logger.log(`Evento: ${eventType}, Estado: ${transactionStatus}`);

    // Solo procesar transacciones aprobadas
    if (eventType !== 'transaction.updated' || transactionStatus !== 'APPROVED') {
      return { received: true };
    }

    // Extraer SKU y datos de la transacción
    const sku =
      body.data?.sku ||
      body.data?.reference ||
      body.data?.transaction?.sku ||
      body.data?.transaction?.reference ||
      body.data?.transaction?.metadata?.sku;

    const transactionId = body.data?.transaction?.id || body.data?.id;
    const amountInCents = body.data?.transaction?.amount_in_cents || body.data?.amount_in_cents || 0;
    const paymentMethod = body.data?.transaction?.payment_method?.type || body.data?.payment_method?.type;

    if (!sku) {
      this.logger.warn('SKU no encontrado en el webhook');
      return { received: true };
    }

    const [planType, billing, tenantId] = sku.split('_');

    if (!tenantId || !planType || !billing) {
      this.logger.warn(`SKU inválido: ${sku}`);
      return { received: true };
    }

    try {
      // Calcular fecha de renovación
      const renewsAt = new Date();
      if (billing === 'annual') {
        renewsAt.setFullYear(renewsAt.getFullYear() + 1);
      } else {
        renewsAt.setMonth(renewsAt.getMonth() + 1);
      }

      // Activar suscripción
      const subscription = await this.subscriptionsService.activateSubscription(
        tenantId,
        planType as any,
        billing as any,
        renewsAt,
      );

      // Registrar pago
      const plan = PLANS[planType as keyof typeof PLANS];
      const amount = billing === 'annual' ? plan.priceAnnual : plan.priceMonthly;

      const payment = await this.subscriptionsService.createPayment({
        tenantId,
        subscriptionId: subscription.id,
        wompiTransactionId: transactionId,
        amount,
        currency: 'COP',
        status: 'approved',
        paymentMethod,
        planType,
        billing,
        description: `Suscripción ${plan.name} (${billing === 'annual' ? 'Anual' : 'Mensual'})`,
        paidAt: new Date(),
      });

      // Crear factura de suscripción
      const tax = Math.round(amount * 0.19); // IVA 19%
      const periodStart = new Date();
      const periodEnd = new Date(renewsAt);

      await this.subscriptionsService.createSubscriptionInvoice({
        tenantId,
        subscriptionId: subscription.id,
        paymentId: payment.id,
        amount,
        tax,
        total: amount + tax,
        planType,
        billing,
        periodStart,
        periodEnd,
        paidAt: new Date(),
      });

      this.logger.log(`Suscripción activada para tenant ${tenantId}: ${planType} (${billing})`);

      // Enviar email de bienvenida
      try {
        await this.sendWelcomeEmail(tenantId, planType, billing);
      } catch (error: any) {
        this.logger.error(`Error enviando email de bienvenida: ${error.message}`);
      }

    } catch (error: any) {
      this.logger.error(`Error procesando webhook: ${error.message}`);
    }

    return { received: true };
  }

  @Post('cancel')
  async cancel(@TenantId() tenantId: string) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant requerido para cancelar la suscripcion.');
    }
    await this.subscriptionsService.cancelSubscription(tenantId);
    return { ok: true, message: 'Suscripción programada para cancelación al final del ciclo.' };
  }

  private async sendWelcomeEmail(tenantId: string, planType: string, billing: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, memberships: { include: { user: { select: { email: true, name: true } } } } },
    });

    if (!tenant || !tenant.memberships.length) return;

    const admin = tenant.memberships.find(m => m.role === 'Administrador' || m.role === 'owner')?.user;
    if (!admin) return;

    const plan = PLANS[planType as keyof typeof PLANS];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'Contex360 <noreply@contex360.com>',
        to: admin.email,
        subject: `¡Bienvenido a Contex360 ${plan.name}! — Suscripción activada`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #18181B; font-size: 24px; margin: 0;">¡Bienvenido a Contex360!</h1>
              <p style="color: #71717A; font-size: 14px; margin-top: 8px;">Tu suscripción ${plan.name} está activa</p>
            </div>
            
            <div style="background: #F4F4F5; border-radius: 12px; padding: 20px; margin: 24px 0;">
              <h3 style="color: #18181B; font-size: 16px; margin: 0 0 12px 0;">Detalles de tu plan:</h3>
              <p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Plan:</strong> ${plan.name}</p>
              <p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Facturación:</strong> ${billing === 'annual' ? 'Anual' : 'Mensual'}</p>
              <p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Empresa:</strong> ${tenant.name}</p>
              ${plan.maxUsers ? `<p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Usuarios:</strong> Hasta ${plan.maxUsers}</p>` : '<p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Usuarios:</strong> Ilimitados</p>'}
              ${plan.maxInvoicesPerMonth ? `<p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Facturas/mes:</strong> Hasta ${plan.maxInvoicesPerMonth}</p>` : '<p style="color: #71717A; font-size: 14px; margin: 4px 0;"><strong>Facturas/mes:</strong> Ilimitadas</p>'}
            </div>

            <div style="text-align: center; margin: 24px 0;">
              <a href="${frontendUrl}" style="display: inline-block; padding: 14px 28px; background: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
                Acceder al Panel
              </a>
            </div>

            <div style="border-top: 1px solid #E4E4E7; padding-top: 16px; margin-top: 24px;">
              <p style="color: #A1A1AA; font-size: 12px; line-height: 1.5;">
                Si tienes alguna pregunta, responde a este email o contacta a nuestro equipo de soporte.
              </p>
            </div>
          </div>
        `,
      });

      this.logger.log(`Email de bienvenida enviado a ${admin.email}`);
    } catch (error: any) {
      this.logger.error(`Error enviando email de bienvenida: ${error.message}`);
    }
  }
}
