import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)
  private startTime = Date.now()

  constructor(private readonly prisma: PrismaService) {}

  async getStatus() {
    const start = Date.now()
    const dbStatus = await this.checkDatabase()
    const responseTimeMs = Date.now() - start
    const memory = process.memoryUsage()

    // Log this health check for SLA tracking
    await this.logUptimeEvent(dbStatus.status, responseTimeMs, dbStatus.message)

    const status = dbStatus.status === 'up' ? 'ok' : 'degraded'

    return {
      status,
      service: 'contex360-backend',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
      database: dbStatus,
      memory: {
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
      },
    }
  }

  async getSlaStatus() {
    const now = new Date()
    const currentStatus = await this.getStatus()
    const monthlySla = await this.calculateMonthlyAvailability(now)
    const yearlySla = await this.calculateYearlyAvailability(now)
    const activeIncidents = await this.getActiveIncidents()

    return {
      service: 'Contex360 ERP',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      currentStatus: currentStatus.status,
      uptimeSeconds: currentStatus.uptimeSeconds,
      sla: {
        monthly: {
          availability: monthlySla.availability,
          totalChecks: monthlySla.totalChecks,
          failedChecks: monthlySla.failedChecks,
          target: 99.5,
          achieved: monthlySla.availability >= 99.5,
        },
        yearly: {
          availability: yearlySla.availability,
          totalChecks: yearlySla.totalChecks,
          failedChecks: yearlySla.failedChecks,
        },
      },
      incidents: activeIncidents,
      lastChecked: new Date().toISOString(),
    }
  }

  async getIncidents(limit = 20, offset = 0) {
    const [incidents, total] = await Promise.all([
      this.prisma.incident.findMany({
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.incident.count(),
    ])
    return { incidents, total, limit, offset }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledHealthCheck() {
    this.logger.log('Ejecutando health check programado...')
    try {
      const start = Date.now()
      const dbStatus = await this.checkDatabase()
      const responseTimeMs = Date.now() - start

      await this.logUptimeEvent(dbStatus.status, responseTimeMs, dbStatus.message)

      if (dbStatus.status !== 'up') {
        await this.createOrUpdateIncident(dbStatus.message)
      }

      this.logger.log(`Health check completado: ${dbStatus.status} (${responseTimeMs}ms)`)
    } catch (error: any) {
      this.logger.error(`Health check programado falló: ${error.message}`)
      await this.logUptimeEvent('down', 0, error.message)
      await this.createOrUpdateIncident(error.message)
    }
  }

  private async logUptimeEvent(status: string, responseTimeMs: number, error?: string) {
    try {
      await this.prisma.uptimeEvent.create({
        data: {
          status,
          responseTimeMs,
          error: error && status !== 'up' ? error : null,
        },
      })
    } catch (e) {
      // Do not throw — logging failure shouldn't crash the app
    }
  }

  private async calculateMonthlyAvailability(now: Date) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    return this.calculateAvailabilityFrom(startOfMonth)
  }

  private async calculateYearlyAvailability(now: Date) {
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    return this.calculateAvailabilityFrom(startOfYear)
  }

  private async calculateAvailabilityFrom(from: Date) {
    try {
      const [totalChecks, failedChecks] = await Promise.all([
        this.prisma.uptimeEvent.count({
          where: { checkedAt: { gte: from } },
        }),
        this.prisma.uptimeEvent.count({
          where: { checkedAt: { gte: from }, status: { not: 'up' } },
        }),
      ])

      const availability = totalChecks > 0
        ? Math.round((1 - failedChecks / totalChecks) * 10000) / 100
        : 100

      return { availability, totalChecks, failedChecks }
    } catch {
      return { availability: 100, totalChecks: 0, failedChecks: 0 }
    }
  }

  private async getActiveIncidents() {
    try {
      return this.prisma.incident.findMany({
        where: { status: { in: ['open', 'investigating'] } },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          severity: true,
          status: true,
          startedAt: true,
        },
      })
    } catch {
      return []
    }
  }

  private async createOrUpdateIncident(errorMessage?: string) {
    try {
      const activeIncident = await this.prisma.incident.findFirst({
        where: { status: { in: ['open', 'investigating'] } },
        orderBy: { startedAt: 'desc' },
      })

      if (!activeIncident) {
        await this.prisma.incident.create({
          data: {
            title: 'Degradación del servicio detectada',
            description: errorMessage || 'El servicio experimentó una degradación no especificada',
            severity: 'major',
            status: 'investigating',
            startedAt: new Date(),
          },
        })
      }
    } catch (e) {
      // Silently handle — incident tracking failure shouldn't crash
    }
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'up' as const }
    } catch (error: any) {
      this.logger.error(`Database health check failed: ${error.message}`)
      return { status: 'down' as const, message: error.message }
    }
  }
}
