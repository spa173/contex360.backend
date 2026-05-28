import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'
import { NotificationService } from '../notification/notification.service'

interface ChurnRiskMetrics {
  totalTenants: number
  atRiskCount: number
  churnedCount: number
  dormantCount: number
  atRiskTenants: { id: string; name: string; reason: string; daysUntilExpiry?: number; daysSinceLastLogin?: number }[]
  churnedTenants: { id: string; name: string; churnedSince: string }[]
  dormantTenants: { id: string; name: string; daysSinceLastLogin: number; planType: string }[]
}

@Injectable()
export class ChurnDetectionService {
  private readonly logger = new Logger(ChurnDetectionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('0 7 * * 1', { timeZone: 'America/Bogota' })
  async runWeeklyChurnDetection() {
    this.logger.log('Iniciando detección semanal de churn...')
    const now = new Date()

    const subscriptions = await this.prisma.subscription.findMany({
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            memberships: { include: { user: { select: { email: true, name: true, lastLoginAt: true } } } },
          },
        },
      },
    })

    for (const sub of subscriptions) {
      const admin = sub.tenant.memberships.find(
        (m) => m.role === 'Administrador' || m.role === 'owner',
      )?.user
      const allUsers = sub.tenant.memberships.map((m) => m.user)
      const lastLoginOverall = allUsers.reduce<Date | null>(
        (latest, u) => (u.lastLoginAt && (!latest || u.lastLoginAt > latest) ? u.lastLoginAt : latest),
        null,
      )

      // Expired subscriptions (already churned)
      if (!sub.active && sub.renewsAt && sub.renewsAt < now) {
        this.logger.log(`Churned detected: ${sub.tenant.name} (${sub.tenantId})`)
        continue
      }

      // At-risk: renewsAt within 7 days
      if (sub.active && sub.renewsAt) {
        const msUntilRenewal = sub.renewsAt.getTime() - now.getTime()
        const daysUntilRenewal = Math.ceil(msUntilRenewal / (1000 * 60 * 60 * 24))

        if (daysUntilRenewal <= 7 && daysUntilRenewal > 0) {
          this.logger.log(`At-risk (renewal imminent): ${sub.tenant.name} — ${daysUntilRenewal}d remaining`)
        }
      }

      // At-risk: no user login in 30+ days
      if (lastLoginOverall) {
        const daysSinceLogin = Math.floor((now.getTime() - lastLoginOverall.getTime()) / (1000 * 60 * 60 * 24))
        if (daysSinceLogin >= 30 && sub.active) {
          if (daysSinceLogin === 30 || daysSinceLogin % 30 === 0) {
            await this.notificationService.sendGenericEmail(
              admin?.email || '',
              'Hace mucho que no visitas Contex360',
              `Hola ${admin?.name || 'usuario'},\n\nNotamos que han pasado ${daysSinceLogin} días desde la última vez que alguien de ${sub.tenant.name} inició sesión en Contex360. Queremos asegurarnos de que todo está funcionando correctamente.\n\nSi necesitas ayuda, responde a este correo o agenda una capacitación con nuestro equipo.\n\n— Equipo Contex360`,
            )
            this.logger.log(`Dormant re-engagement sent to ${admin?.email} for ${sub.tenant.name} (${daysSinceLogin}d)`)
          }
        }
      }
    }

    this.logger.log('Detección semanal de churn completada.')
  }

  async getChurnMetrics(): Promise<ChurnRiskMetrics> {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    const subscriptions = await this.prisma.subscription.findMany({
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            memberships: { include: { user: { select: { email: true, name: true, lastLoginAt: true } } } },
          },
        },
      },
    })

    const atRiskTenants: ChurnRiskMetrics['atRiskTenants'] = []
    const churnedTenants: ChurnRiskMetrics['churnedTenants'] = []
    const dormantTenants: ChurnRiskMetrics['dormantTenants'] = []

    for (const sub of subscriptions) {
      const allUsers = sub.tenant.memberships.map((m) => m.user)
      const lastLoginOverall = allUsers.reduce<Date | null>(
        (latest, u) => (u.lastLoginAt && (!latest || u.lastLoginAt > latest) ? u.lastLoginAt : latest),
        null,
      )

      if (!sub.active && sub.renewsAt && sub.renewsAt < now) {
        churnedTenants.push({
          id: sub.tenant.id,
          name: sub.tenant.name,
          churnedSince: sub.renewsAt.toISOString(),
        })
        continue
      }

      if (sub.active && sub.renewsAt) {
        const msUntilRenewal = sub.renewsAt.getTime() - now.getTime()
        const daysUntilExpiry = Math.ceil(msUntilRenewal / (1000 * 60 * 60 * 24))

        if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
          atRiskTenants.push({
            id: sub.tenant.id,
            name: sub.tenant.name,
            reason: 'Renovación próxima',
            daysUntilExpiry,
          })
        }
      }

      if (lastLoginOverall && lastLoginOverall < thirtyDaysAgo && sub.active) {
        const daysSinceLastLogin = Math.floor((now.getTime() - lastLoginOverall.getTime()) / (1000 * 60 * 60 * 24))
        dormantTenants.push({
          id: sub.tenant.id,
          name: sub.tenant.name,
          daysSinceLastLogin,
          planType: sub.planType,
        })
      } else if (!lastLoginOverall && sub.createdAt < ninetyDaysAgo && sub.active) {
        dormantTenants.push({
          id: sub.tenant.id,
          name: sub.tenant.name,
          daysSinceLastLogin: 0,
          planType: sub.planType,
        })
      }
    }

    return {
      totalTenants: subscriptions.length,
      atRiskCount: atRiskTenants.length,
      churnedCount: churnedTenants.length,
      dormantCount: dormantTenants.length,
      atRiskTenants,
      churnedTenants,
      dormantTenants,
    }
  }
}
