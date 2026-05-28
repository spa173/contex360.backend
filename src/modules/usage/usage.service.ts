import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { PLANS, PlanConfig } from '../subscriptions/plans.config'

function resolvePlanKey(planType?: string | null): 'starter' | 'pyme' | 'enterprise' {
  const normalized = String(planType || 'starter').toLowerCase()
  return (normalized in PLANS) ? (normalized as 'starter' | 'pyme' | 'enterprise') : 'starter'
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(private readonly prisma: PrismaService) {}

  async recordUsage(tenantId: string, feature: string, quantity = 1) {
    try {
      await this.prisma.usageRecord.create({
        data: { tenantId, feature, quantity },
      })
    } catch (error: any) {
      this.logger.error(`Error registrando usage: ${error.message}`)
    }
  }

  async getUsage(tenantId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    })

    const planKey = resolvePlanKey(subscription?.planType)
    const limits = PLANS[planKey]
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const featureUsage = await this.getFeatureUsage(tenantId, startOfMonth)

    return {
      planType: planKey,
      limits,
      usage: featureUsage,
      overages: this.calculateOverage(featureUsage, limits),
    }
  }

  async checkLimit(tenantId: string, feature: string): Promise<{ allowed: boolean; current: number; limit: number | null }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    })

    const planKey = resolvePlanKey(subscription?.planType)
    const limits = PLANS[planKey]
    const limit = this.getLimitForFeature(feature, limits)

    if (limit === null) {
      return { allowed: true, current: 0, limit: null }
    }

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const aggregate = await this.prisma.usageRecord.aggregate({
      where: {
        tenantId,
        feature,
        recordedAt: { gte: startOfMonth },
      },
      _sum: { quantity: true },
    })

    const current = aggregate._sum.quantity || 0

    return {
      allowed: current < limit,
      current,
      limit,
    }
  }

  private async getFeatureUsage(tenantId: string, startOfMonth: Date) {
    const features = ['invoice_created', 'ai_query', 'ocr_run', 'email_sent']
    const usage: Record<string, { current: number; limit: number | null }> = {}

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
    })
    const planKey = resolvePlanKey(subscription?.planType)
    const limits = PLANS[planKey]

    for (const feature of features) {
      const limit = this.getLimitForFeature(feature, limits)

      const aggregate = await this.prisma.usageRecord.aggregate({
        where: {
          tenantId,
          feature,
          recordedAt: { gte: startOfMonth },
        },
        _sum: { quantity: true },
      })

      usage[feature] = {
        current: aggregate._sum.quantity || 0,
        limit,
      }
    }

    // Include invoicesThisMonth from subscription for backwards compatibility
    usage['invoices'] = {
      current: subscription?.invoicesThisMonth || 0,
      limit: limits.maxInvoicesPerMonth,
    }

    const usersCount = await this.prisma.membership.count({ where: { tenantId } })
    usage['users'] = {
      current: usersCount,
      limit: limits.maxUsers,
    }

    return usage
  }

  private calculateOverage(usage: Record<string, { current: number; limit: number | null }>, limits: PlanConfig) {
    const overages: Array<{ feature: string; current: number; limit: number; excess: number }> = []

    for (const [feature, data] of Object.entries(usage)) {
      if (data.limit !== null && data.current > data.limit) {
        overages.push({
          feature,
          current: data.current,
          limit: data.limit,
          excess: data.current - data.limit,
        })
      }
    }

    return overages
  }

  private getLimitForFeature(feature: string, limits: PlanConfig): number | null {
    const map: Record<string, keyof PlanConfig> = {
      invoice_created: 'maxInvoicesPerMonth',
      ai_query: 'maxAiQueriesPerMonth',
      ocr_run: 'maxOcrRunsPerMonth',
      email_sent: 'maxEmailsPerMonth',
      users: 'maxUsers',
    }

    const key = map[feature]
    if (!key) return null

    const value = limits[key]
    return value as number | null
  }
}
