import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PLAN_MODULE_KEY, PLAN_LIMIT_KEY } from './plan.decorator'
import { IS_PUBLIC_KEY } from './public.decorator'
import { AuthenticatedRequest } from './auth.types'
import { PrismaService } from '../database/prisma.service'
import { PLANS, PlanConfig } from '../subscriptions/plans.config'

function resolvePlanKey(planType?: string | null): 'starter' | 'pyme' | 'enterprise' {
  const normalized = String(planType || 'starter').toLowerCase()
  return (normalized in PLANS) ? (normalized as 'starter' | 'pyme' | 'enterprise') : 'starter'
}

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const requiredModule = this.reflector.getAllAndOverride<string>(PLAN_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const requiredLimit = this.reflector.getAllAndOverride<'maxInvoicesPerMonth' | 'maxUsers'>(PLAN_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredModule && !requiredLimit) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authUser = request.authUser
    if (!authUser) {
      return false
    }

    if (authUser.isSystemOwner) {
      return true
    }

    const headerTenantId = (request.headers as Record<string, string | string[] | undefined>)['x-tenant-id'] as string | undefined
    const activeTenantId = headerTenantId || authUser.tenantId
    if (!activeTenantId) {
      throw new ForbiddenException('Tenant no identificado.')
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: activeTenantId },
    })

    const planKey = resolvePlanKey(subscription?.planType)
    const planConfig: PlanConfig = PLANS[planKey]

    if (requiredModule) {
      if (planConfig.modules.includes('*')) return true
      if (!planConfig.modules.includes(requiredModule)) {
        throw new ForbiddenException(`El plan ${planConfig.name} no incluye el módulo ${requiredModule}.`)
      }
    }

    if (requiredLimit) {
      if (requiredLimit === 'maxInvoicesPerMonth') {
        const maxInvoices = planConfig.maxInvoicesPerMonth
        if (maxInvoices !== null) {
          const currentInvoices = subscription?.invoicesThisMonth ?? 0
          if (currentInvoices >= maxInvoices) {
            throw new ForbiddenException(`Límite mensual de facturas alcanzado (${maxInvoices}).`)
          }
        }
      }

      if (requiredLimit === 'maxUsers') {
        const maxUsers = planConfig.maxUsers
        if (maxUsers !== null) {
          const userCount = await this.prisma.membership.count({
            where: { tenantId: activeTenantId },
          })
          if (userCount >= maxUsers) {
            throw new ForbiddenException(`Límite de usuarios alcanzado (${maxUsers}).`)
          }
        }
      }
    }

    return true
  }
}
