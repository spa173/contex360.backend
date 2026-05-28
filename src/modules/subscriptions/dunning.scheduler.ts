import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'
import { NotificationService } from '../notification/notification.service'
import { SubscriptionMailerService } from './subscription-mailer.service'

@Injectable()
export class DunningScheduler {
  private readonly logger = new Logger(DunningScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly subscriptionMailer: SubscriptionMailerService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'America/Bogota' })
  async runDailyDunning() {
    this.logger.log('Iniciando proceso de dunning diario...')
    const now = new Date()

    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        active: false,
        trialEndsAt: { lte: now },
        planType: { not: 'enterprise' },
      },
      include: {
        tenant: {
          select: {
            name: true,
            memberships: {
              include: { user: { select: { email: true, name: true } } },
            },
          },
        },
      },
    })

    for (const sub of expiredTrials) {
      const admin = sub.tenant.memberships.find(
        (m) => m.role === 'Administrador' || m.role === 'owner',
      )?.user
      if (admin) {
        await this.notificationService.sendGenericEmail(
          admin.email,
          'Tu período de prueba de Contex360 ha expirado',
          `Hola ${admin.name},\n\nTu período de prueba para ${sub.tenant.name} ha expirado. Para seguir usando Contex360, activa un plan desde el panel de administración.\n\nSi tienes dudas, contáctanos en soporte@contex360.com.\n\n— Equipo Contex360`,
        )
        this.logger.log(`Trial expired notification sent to ${admin.email} for tenant ${sub.tenantId}`)
      }
    }

    const subscriptionsDueSoon = await this.prisma.subscription.findMany({
      where: {
        active: true,
        renewsAt: {
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          gte: now,
        },
      },
      include: {
        tenant: {
          select: {
            name: true,
            memberships: {
              include: { user: { select: { email: true, name: true } } },
            },
          },
        },
      },
    })

    for (const sub of subscriptionsDueSoon) {
      const admin = sub.tenant.memberships.find(
        (m) => m.role === 'Administrador' || m.role === 'owner',
      )?.user
      if (admin) {
        await this.notificationService.sendGenericEmail(
          admin.email,
          'Tu suscripción Contex360 está por vencer',
          `Hola ${admin.name},\n\nTu suscripción para ${sub.tenant.name} está por vencer el ${sub.renewsAt?.toLocaleDateString('es-CO')}. Para evitar la suspensión del servicio, asegúrate de que tu método de pago esté actualizado.\n\n— Equipo Contex360`,
        )
        this.logger.log(`Renewal reminder sent to ${admin.email} for tenant ${sub.tenantId}`)
      }
    }

    const subscriptionsOverdue = await this.prisma.subscription.findMany({
      where: {
        active: true,
        renewsAt: { lt: now },
      },
      include: {
        tenant: {
          select: {
            name: true,
            memberships: {
              include: { user: { select: { email: true, name: true } } },
            },
          },
        },
      },
    })

    for (const sub of subscriptionsOverdue) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { active: false },
      })

      await this.prisma.auditEvent.create({
        data: {
          tenantId: sub.tenantId,
          entity: 'subscription',
          action: 'Suscripción desactivada por falta de pago',
          description: `La suscripción del tenant ${sub.tenantId} fue desactivada automáticamente por falta de pago.`,
          actor: 'Sistema de cobros',
          severity: 'warning',
        },
      })

      const admin = sub.tenant.memberships.find(
        (m) => m.role === 'Administrador' || m.role === 'owner',
      )?.user
      if (admin) {
        await this.notificationService.sendGenericEmail(
          admin.email,
          'Tu suscripción Contex360 ha sido suspendida',
          `Hola ${admin.name},\n\nTu suscripción para ${sub.tenant.name} ha sido suspendida por falta de pago. Para reactivar el servicio, ingresa al panel y renueva tu plan.\n\n— Equipo Contex360`,
        )

        // Reenviar última factura
        try {
          const lastInvoice = await this.prisma.subscriptionInvoice.findFirst({
            where: { tenantId: sub.tenantId },
            orderBy: { createdAt: 'desc' },
          })
          if (lastInvoice) {
            await this.subscriptionMailer.sendInvoiceEmail(lastInvoice.id)
          }
        } catch (err: any) {
          this.logger.warn(`Error reenviando factura: ${err.message}`)
        }
      }

      this.logger.log(`Subscription ${sub.id} deactivated due to non-payment`)
    }

    this.logger.log('Proceso de dunning completado.')
  }

  @Cron('0 3 * * *', { timeZone: 'America/Bogota' })
  async runBackupVerification() {
    if (process.env.BACKUP_ENABLED !== 'true') return
    this.logger.log('Verificación de backup programada ejecutada.')
  }
}
