import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PLANS } from './plans.config';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });

    if (!subscription) {
      return {
        plan: 'starter',
        active: true,
        trialDaysRemaining: 0,
        invoicesThisMonth: 0,
        limits: PLANS.starter,
      };
    }

    const planTypeLower = subscription.planType.toLowerCase();
    const planKey = (planTypeLower in PLANS) ? (planTypeLower as 'starter' | 'pyme' | 'enterprise') : 'starter';
    const limits = PLANS[planKey];

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
      plan: subscription.planType,
      active: subscription.active,
      trialDaysRemaining,
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

    const planTypeLower = subscription.planType.toLowerCase();
    const planKey = (planTypeLower in PLANS) ? (planTypeLower as 'starter' | 'pyme' | 'enterprise') : 'starter';

    return {
      planType: subscription.planType,
      invoicesThisMonth: subscription.invoicesThisMonth,
      usersCount,
      renewsAt: subscription.renewsAt,
      limits: PLANS[planKey],
    };
  }
}
