import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PLANS } from './plans.config';
import { Prisma } from '@prisma/client';
import { UsageService } from '../usage/usage.service';

function resolvePlanKey(planType?: string | null) {
  const normalized = String(planType || 'starter').toLowerCase();
  return (normalized in PLANS) ? (normalized as 'starter' | 'pyme' | 'enterprise') : 'starter';
}

function toLimitSnapshot(planKey: 'starter' | 'pyme' | 'enterprise') {
  return PLANS[planKey];
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
  ) {}

  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return {
        planType: 'starter',
        active: true,
        billing: 'monthly',
        trialDaysRemaining: 0,
        invoicesThisMonth: 0,
        trialEndsAt: null,
        renewsAt: null,
        cancelAt: null,
        limits: PLANS.starter,
      };
    }

    const planKey = resolvePlanKey(subscription.planType);
    const limits = toLimitSnapshot(planKey);

    let trialDaysRemaining = 0;
    if (subscription.trialEndsAt) {
      const endsAt = new Date(subscription.trialEndsAt);
      const now = new Date();
      trialDaysRemaining = Math.max(
        0,
        Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }

    return {
      planType: subscription.planType,
      active: subscription.active,
      billing: subscription.billing,
      trialDaysRemaining,
      trialEndsAt: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
      renewsAt: subscription.renewsAt ? subscription.renewsAt.toISOString() : null,
      cancelAt: subscription.cancelAt ? subscription.cancelAt.toISOString() : null,
      invoicesThisMonth: subscription.invoicesThisMonth,
      limits,
    };
  }

  async getUsage(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    const planKey = subscription
      ? resolvePlanKey(subscription.planType)
      : 'starter';
    const limits = toLimitSnapshot(planKey);

    const featureUsage = await this.usageService.getUsage(tenantId);

    return {
      planType: planKey,
      invoicesThisMonth: subscription?.invoicesThisMonth ?? 0,
      limits,
      usage: featureUsage.usage,
      overages: featureUsage.overages,
      renewsAt: subscription?.renewsAt ?? null,
    };
  }

  async activateSubscription(
    tenantId: string,
    planType: 'starter' | 'pyme' | 'enterprise',
    billing: 'monthly' | 'annual',
    renewsAt: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planType,
        billing,
        active: true,
        trialEndsAt: null,
        renewsAt,
        invoicesThisMonth: 0,
      },
      update: {
        active: true,
        planType,
        billing,
        trialEndsAt: null,
        renewsAt,
        cancelAt: null,
      },
    });
  }

  async cancelSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      throw new Error('No hay suscripción activa para cancelar.');
    }

    // Programar cancelación al final del ciclo actual
    const cancelAt = subscription.renewsAt || new Date();

    return this.prisma.subscription.update({
      where: { tenantId },
      data: {
        cancelAt,
      },
    });
  }

  async confirmCancellation(tenantId: string) {
    return this.prisma.subscription.update({
      where: { tenantId },
      data: {
        active: false,
        cancelAt: null,
      },
    });
  }

  async createPayment(data: {
    tenantId: string;
    subscriptionId?: string;
    wompiTransactionId?: string;
    amount: number;
    currency?: string;
    status: string;
    paymentMethod?: string;
    planType?: string;
    billing?: string;
    description?: string;
    paidAt?: Date;
    processedAt?: Date,
  }, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return client.payment.create({
      data: {
        tenantId: data.tenantId,
        subscriptionId: data.subscriptionId,
        wompiTransactionId: data.wompiTransactionId,
        amount: data.amount,
        currency: data.currency || 'COP',
        status: data.status,
        paymentMethod: data.paymentMethod,
        planType: data.planType,
        billing: data.billing,
        description: data.description,
        paidAt: data.paidAt,
        processedAt: data.processedAt,
      },
    });
  }

  async createSubscriptionInvoice(data: {
    tenantId: string;
    subscriptionId: string;
    paymentId?: string;
    amount: number;
    tax: number;
    total: number;
    planType: string;
    billing: string;
    periodStart: Date;
    periodEnd: Date;
    paidAt?: Date;
  }, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    const invoiceNumber = await this.generateInvoiceNumber(data.tenantId);

    return client.subscriptionInvoice.create({
      data: {
        tenantId: data.tenantId,
        subscriptionId: data.subscriptionId,
        paymentId: data.paymentId,
        invoiceNumber,
        amount: data.amount,
        tax: data.tax,
        total: data.total,
        status: data.paidAt ? 'paid' : 'pending',
        planType: data.planType,
        billing: data.billing,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        paidAt: data.paidAt,
      },
    });
  }

  async getPaymentHistory(tenantId: string, limit = 20) {
    return this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getInvoiceHistory(tenantId: string, limit = 20) {
    return this.prisma.subscriptionInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getPaymentById(paymentId: string) {
    return this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
  }

  async linkPaymentToInvoice(paymentId: string, invoiceId: string) {
    return this.prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: {
        paymentId,
        status: 'paid',
        paidAt: new Date(),
      },
    });
  }

  private async generateInvoiceNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    const count = await this.prisma.subscriptionInvoice.count({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(year, now.getMonth(), 1),
          lt: new Date(year, now.getMonth() + 1, 1),
        },
      },
    });

    return `SUB-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
}
