import { Injectable, Logger, Controller, Get, Post, Body, Headers, HttpCode, HttpStatus, UseGuards, BadRequestException, ForbiddenException, Delete, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { WompiService } from './wompi.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Public } from '../auth/public.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { CheckoutDto, WompiWebhookDto } from './subscriptions.dto';
import { PLANS } from './plans.config';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { DianService, type TenantDianConfig } from '../dian/dian.service';
import { PdfService } from './pdf.service';
import { SubscriptionMailerService } from './subscription-mailer.service';
import { CurrencyService } from './currency.service';
import type { AuthTokenPayload } from '../auth/auth.types';

@Controller('subscriptions')
@UseGuards(AuthGuard, PermissionsGuard)
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly dianService: DianService,
    private readonly pdfService: PdfService,
    private readonly subscriptionMailer: SubscriptionMailerService,
    private readonly currencyService: CurrencyService,
  ) {}

  @Get('currencies')
  getCurrencies() {
    return this.currencyService.getAvailableCurrencies()
  }

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

  @Get('invoices/:id/pdf')
  async downloadInvoicePdf(@TenantId() tenantId: string, @Param('id') id: string, @Res() res: Response) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { id, tenantId },
      include: {
        tenant: {
          select: {
            name: true,
            nit: true,
            address: true,
            phone: true,
            invoiceResolution: true,
            resolutionFrom: true,
            resolutionTo: true,
            dianEnvironment: true,
            dianOperationCode: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new BadRequestException('Factura no encontrada');
    }

    const pdfPath = await this.pdfService.generateInvoicePdf(
      {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        tax: invoice.tax,
        total: invoice.total,
        planType: invoice.planType,
        billing: invoice.billing,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
        cufe: invoice.cufe,
        dianStatus: invoice.dianStatus,
      },
      {
        name: invoice.tenant.name,
        nit: invoice.tenant.nit || '',
        address: invoice.tenant.address || undefined,
        phone: invoice.tenant.phone || undefined,
        resolution: invoice.tenant.invoiceResolution || undefined,
        resolutionFrom: invoice.tenant.resolutionFrom,
        resolutionTo: invoice.tenant.resolutionTo,
        operationCode: invoice.tenant.dianOperationCode || undefined,
        environment: invoice.tenant.dianEnvironment || undefined,
      },
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.sendFile(pdfPath);
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

  @Public()
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

    const sku =
      body.data?.sku ||
      body.data?.reference ||
      body.data?.transaction?.sku ||
      body.data?.transaction?.reference ||
      body.data?.transaction?.metadata?.sku;

    const transactionId = body.data?.transaction?.id || body.data?.id;
    const paymentMethod = body.data?.transaction?.payment_method?.type || body.data?.payment_method?.type;

    if (eventType !== 'transaction.updated' || transactionStatus !== 'APPROVED') {
      if (['DECLINED', 'VOIDED', 'ERROR', 'EXPIRED'].includes(transactionStatus)) {
        await this.handleFailedPayment(body, transactionId, sku, transactionStatus);
      }
      return { received: true };
    }

    if (!sku) {
      this.logger.warn('SKU no encontrado en el webhook');
      return { received: true };
    }

    const [planType, billing, tenantId] = sku.split('_');
    if (!tenantId || !planType || !billing) {
      this.logger.warn(`SKU inválido: ${sku}`);
      return { received: true };
    }

    let subscriptionInvoice: any;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Idempotencia: verificar si la transacción ya fue procesada
        if (transactionId) {
          const existingPayment = await tx.payment.findUnique({
            where: { wompiTransactionId: transactionId },
          });
          if (existingPayment) {
            this.logger.log(`Transacción ${transactionId} ya procesada — saltando`);
            return;
          }
        }

        // 2. Calcular fecha de renovación
        const renewsAt = new Date();
        if (billing === 'annual') {
          renewsAt.setFullYear(renewsAt.getFullYear() + 1);
        } else {
          renewsAt.setMonth(renewsAt.getMonth() + 1);
        }

        // 3. Activar suscripción (upsert => idempotente por diseño)
        const subscription = await this.subscriptionsService.activateSubscription(
          tenantId,
          planType as any,
          billing as any,
          renewsAt,
          tx,
        );

        // 4. Registrar pago con processedAt
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
          processedAt: new Date(),
        }, tx);

        // 5. Crear factura de suscripción
        const tax = Math.round(amount * 0.19);
        const periodStart = new Date();
        const periodEnd = new Date(renewsAt);

        subscriptionInvoice = await this.subscriptionsService.createSubscriptionInvoice({
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
        }, tx);

        // 6. Incrementar contador de facturas del mes
        await tx.subscription.update({
          where: { tenantId },
          data: { invoicesThisMonth: { increment: 1 } },
        });

        this.logger.log(`Suscripción activada para tenant ${tenantId}: ${planType} (${billing})`);

        // Guardamos datos necesarios para post-procesamiento (emails, DIAN)
        // Se ejecutarán después del commit para no bloquear la transacción
      });

      // Post-procesamiento (emails, DIAN — no crítico para atomicidad del pago)
      if (subscriptionInvoice) {
        try {
          await this.subscriptionMailer.sendInvoiceEmail(subscriptionInvoice.id);
        } catch (error: any) {
          this.logger.warn(`Error enviando factura por email: ${error.message}`);
        }

        try {
          await this.issueSaaSInvoice(tenantId, {
            subscriptionInvoiceId: subscriptionInvoice.id,
            planType,
            billing,
            amount: subscriptionInvoice.amount,
            tax: subscriptionInvoice.tax,
            total: subscriptionInvoice.total,
            periodStart: subscriptionInvoice.periodStart,
            periodEnd: subscriptionInvoice.periodEnd,
            paidAt: subscriptionInvoice.paidAt,
          });
        } catch (error: any) {
          this.logger.warn(`Factura DIAN del SaaS no generada: ${error.message}`);
        }

        try {
          await this.sendWelcomeEmail(tenantId, planType, billing);
        } catch (error: any) {
          this.logger.error(`Error enviando email de bienvenida: ${error.message}`);
        }
      }
    } catch (error: any) {
      // P2002 = unique constraint violation (concurrencia: otro webhook ya creó el pago)
      if (error.code === 'P2002') {
        this.logger.log(`Transacción ${transactionId} ya procesada (concurrencia) — saltando`);
        return { received: true };
      }
      this.logger.error(`Error procesando webhook: ${error.message}`);
      throw error;
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

  @Post('export')
  async exportData(@TenantId() tenantId: string, @AuthUser() authUser: AuthTokenPayload) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant requerido para exportar datos.');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: authUser.sub, tenantId } },
    });
    if (!membership && !authUser.isSystemOwner) {
      throw new ForbiddenException('No tienes acceso a los datos de esta empresa.');
    }

    const [products, thirdParties, invoices, purchases, transactions, ledgerEntries] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.thirdParty.findMany({ where: { tenantId } }),
      this.prisma.invoice.findMany({ where: { tenantId }, include: { items: true } }),
      this.prisma.purchase.findMany({ where: { tenantId }, include: { items: true } }),
      this.prisma.transaction.findMany({ where: { tenantId } }),
      this.prisma.ledgerEntry.findMany({ where: { tenantId }, include: { lines: true } }),
    ]);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });

    const exportData = {
      exportedAt: new Date().toISOString(),
      tenant: {
        name: tenant?.name,
        nit: tenant?.nit,
        prefix: tenant?.prefix,
      },
      products,
      thirdParties,
      invoices,
      purchases,
      transactions,
      ledgerEntries,
    };

    await this.prisma.auditEvent.create({
      data: {
        tenantId,
        entity: 'tenant',
        action: 'Datos exportados',
        description: `El usuario ${authUser.sub} exportó los datos del tenant ${tenantId} en cumplimiento del Art. 13 Ley 1581 de 2012.`,
        actor: authUser.sub,
        actorUserId: authUser.sub,
        severity: 'info',
      },
    });

    return exportData;
  }

  @Delete('account')
  async deleteAccount(@TenantId() tenantId: string, @AuthUser() authUser: AuthTokenPayload) {
    if (!tenantId) {
      throw new ForbiddenException('Tenant requerido.');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: authUser.sub, tenantId } },
    });
    if (!membership && !authUser.isSystemOwner) {
      throw new ForbiddenException('No tienes permisos para eliminar esta empresa.');
    }

    const otherMemberships = await this.prisma.membership.count({
      where: { userId: authUser.sub, tenantId: { not: tenantId } },
    });
    if (otherMemberships === 0 && !authUser.isSystemOwner) {
      throw new ForbiddenException(
        'No puedes eliminar tu única empresa. Si deseas eliminar tu cuenta, contacta al administrador del sistema.'
      );
    }

    await this.prisma.$transaction([
      this.prisma.membership.deleteMany({ where: { tenantId } }),
      this.prisma.userSession.updateMany({ where: { tenantId }, data: { revokedAt: new Date(), revokedBy: 'Autoeliminación' } }),
      this.prisma.refreshToken.updateMany({ where: { userId: authUser.sub }, data: { revokedAt: new Date() } }),
      this.prisma.auditEvent.create({
        data: {
          tenantId,
          entity: 'tenant',
          action: 'Cuenta autoeliminada',
          description: `El tenant ${tenantId} fue eliminado por el usuario ${authUser.sub} mediante autoeliminación.`,
          actor: authUser.sub,
          actorUserId: authUser.sub,
          severity: 'warning',
        },
      }),
    ]);

    await this.prisma.tenant.delete({ where: { id: tenantId } });

    return { ok: true, message: 'Tu empresa ha sido eliminada correctamente. Todos los datos han sido borrados.' };
  }

  private async handleFailedPayment(body: any, transactionId: string, sku: string, status: string) {
    try {
      const [, , tenantId] = sku.split('_');
      if (!tenantId) return;

      this.logger.warn(`Pago fallido para tenant ${tenantId}: ${status} (tx: ${transactionId})`);

      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          entity: 'subscription',
          action: `Pago ${status.toLowerCase()}`,
          description: `Transacción Wompi ${transactionId} — ${status}`,
          actor: 'Sistema de pagos',
          severity: 'warning',
        },
      });

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, memberships: { include: { user: { select: { email: true, name: true } } } } },
      });
      if (!tenant) return;

      const admin = tenant.memberships.find(m => m.role === 'Administrador' || m.role === 'owner')?.user;
      if (admin?.email) {
        await this.notificationService.sendGenericEmail(
          admin.email,
          'Problema con tu pago de Contex360',
          `Hola ${admin.name},\n\nEl pago de tu suscripción para ${tenant.name} fue ${status === 'DECLINED' ? 'rechazado' : 'fallido'} (${status}).\n\nPor favor, actualiza tu método de pago desde el panel de administración para evitar la suspensión del servicio.\n\n— Equipo Contex360`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Error manejando pago fallido: ${err.message}`);
    }
  }

  private async issueSaaSInvoice(
    tenantId: string,
    data: {
      subscriptionInvoiceId: string;
      planType: string;
      billing: string;
      amount: number;
      tax: number;
      total: number;
      periodStart: Date;
      periodEnd: Date;
      paidAt: Date;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    const systemNit = process.env.SAAS_DIAN_NIT;
    const systemSoftwareId = process.env.SAAS_DIAN_SOFTWARE_ID;
    const systemSoftwarePin = process.env.SAAS_DIAN_SOFTWARE_PIN;
    const systemCertificate = process.env.SAAS_DIAN_CERTIFICATE;
    const systemCertificatePassword = process.env.SAAS_DIAN_CERTIFICATE_PASSWORD;
    const systemDianEnv = process.env.SAAS_DIAN_ENVIRONMENT || 'test';

    if (!systemNit || !systemSoftwareId || !systemCertificate) {
      this.logger.warn('SAAS_DIAN_* env vars not configured — skipping SaaS DIAN invoice');
      return;
    }

    const [tenant, adminMember] = await Promise.all([
      client.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          nit: true,
          dianNit: true,
          invoicePrefix: true,
          memberships: {
            where: { role: { in: ['Administrador', 'owner'] } },
            take: 1,
            include: { user: { select: { email: true, name: true } } },
          },
        },
      }),
      client.membership.findFirst({
        where: { tenantId, role: { in: ['Administrador', 'owner'] } },
        include: { user: { select: { email: true, name: true } } },
      }),
    ]);

    if (!tenant) {
      this.logger.warn(`Tenant ${tenantId} not found — skipping SaaS DIAN invoice`);
      return;
    }

    const adminUser = adminMember?.user;
    const clientEmail = adminUser?.email || '';
    const clientNit = tenant.dianNit || tenant.nit || '000000000';
    const invoiceNumber = `SUB-${data.subscriptionInvoiceId.slice(0, 8).toUpperCase()}`;
    const plan = PLANS[data.planType as keyof typeof PLANS];

    const dianPayload = {
      invoiceId: data.subscriptionInvoiceId,
      tenantId,
      number: invoiceNumber,
      issuedAt: data.paidAt,
      dueAt: new Date(data.paidAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      subtotal: data.amount,
      taxTotal: data.tax,
      total: data.total,
      client: {
        name: tenant.name,
        nit: clientNit,
        email: clientEmail,
      },
      items: [
        {
          productName: `Suscripción Contex360 ${plan?.name || data.planType} — ${data.billing === 'annual' ? 'Anual' : 'Mensual'} (${data.periodStart.toLocaleDateString('es-CO')} - ${data.periodEnd.toLocaleDateString('es-CO')})`,
          quantity: 1,
          unitPrice: data.amount,
          taxRate: 19,
          subtotal: data.amount,
          taxAmount: data.tax,
        },
      ],
    };

    const issuerConfig: TenantDianConfig = {
      id: 'system',
      name: process.env.SAAS_COMPANY_NAME || 'Contex360 SAS',
      prefix: process.env.SAAS_DIAN_PREFIX || '',
      nit: systemNit,
      invoicePrefix: 'SUB',
      lastInvoiceNumber: 0,
      invoiceResolution: process.env.SAAS_DIAN_RESOLUTION || null,
      resolutionFrom: process.env.SAAS_DIAN_RESOLUTION_FROM ? new Date(process.env.SAAS_DIAN_RESOLUTION_FROM) : null,
      resolutionTo: process.env.SAAS_DIAN_RESOLUTION_TO ? new Date(process.env.SAAS_DIAN_RESOLUTION_TO) : null,
      dianEnvironment: systemDianEnv,
      dianTestSetId: process.env.SAAS_DIAN_TEST_SET_ID || null,
      dianSoftwareId: systemSoftwareId,
      dianSoftwarePin: systemSoftwarePin || '',
      dianCertificate: systemCertificate,
      dianCertificatePassword: systemCertificatePassword || '',
      dianNit: systemNit,
      dianOperationCode: '10',
    };

    const dianResponse = await this.dianService.sendInvoice(dianPayload, {
      tenant: issuerConfig,
      entityType: 'subscription',
    });

    // Build timeline event
    const timelineEvent = {
      type: 'dian',
      action: 'send',
      at: new Date().toISOString(),
      status: dianResponse.status,
      message: dianResponse.message,
      cufe: dianResponse.cufe,
      trackId: dianResponse.dianTrackingId,
      xmlFileName: dianResponse.xmlFileName,
    };

    // Get existing timeline or start new one
    const existingInvoice = await client.subscriptionInvoice.findUnique({
      where: { id: data.subscriptionInvoiceId },
      select: { timeline: true },
    });
    const existingTimeline = (existingInvoice?.timeline as any[]) || [];

    await client.subscriptionInvoice.update({
      where: { id: data.subscriptionInvoiceId },
      data: {
        cufe: dianResponse.cufe || null,
        dianStatus: dianResponse.status,
        xmlFileName: dianResponse.xmlFileName || null,
        timeline: [...existingTimeline, timelineEvent],
      },
    });

    this.logger.log(`SaaS DIAN invoice ${invoiceNumber}: ${dianResponse.status} — ${dianResponse.message}`);
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
