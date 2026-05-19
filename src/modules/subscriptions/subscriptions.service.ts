import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PLANS } from './plans.config';

function resolvePlanKey(planType?: string | null) {
  const normalized = String(planType || 'starter').toLowerCase();
  return (normalized in PLANS) ? (normalized as 'starter' | 'pyme' | 'enterprise') : 'starter';
}

function toLimitSnapshot(planKey: 'starter' | 'pyme' | 'enterprise') {
  return PLANS[planKey];
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return {
        planType: 'starter',
        active: true,
        trialDaysRemaining: 0,
        invoicesThisMonth: 0,
        trialEndsAt: null,
        renewsAt: null,
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
      trialDaysRemaining,
      trialEndsAt: subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
      renewsAt: subscription.renewsAt ? subscription.renewsAt.toISOString() : null,
      invoicesThisMonth: subscription.invoicesThisMonth,
      limits,
    };
  }

  async getUsage(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    const usersCount = await this.prisma.membership.count({
      where: { tenantId },
    });

    if (!subscription) {
      return {
        planType: 'starter',
        invoicesThisMonth: 0,
        usersCount,
        renewsAt: null,
        limits: PLANS.starter,
      };
    }

    const planKey = resolvePlanKey(subscription.planType);

    return {
      planType: subscription.planType,
      invoicesThisMonth: subscription.invoicesThisMonth,
      usersCount,
      renewsAt: subscription.renewsAt,
      limits: toLimitSnapshot(planKey),
    };
  }

  async activateSubscription(
    tenantId: string,
    planType: 'starter' | 'pyme' | 'enterprise',
    billing: 'monthly' | 'annual',
    renewsAt: Date,
  ) {
    return this.prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planType,
        active: true,
        trialEndsAt: null,
        renewsAt,
        invoicesThisMonth: 0,
      },
      update: {
        active: true,
        planType,
        trialEndsAt: null,
        renewsAt,
      },
    })
  }

  async cancelSubscription(tenantId: string) {
    return this.prisma.subscription.updateMany({
      where: { tenantId },
      data: {
        active: false,
      },
    })
  }
}
