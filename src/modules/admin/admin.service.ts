import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuditSeverity, Prisma, UserStatus } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { hashSync, compare } from 'bcryptjs'
import { PrismaService } from '../database/prisma.service'
import { NotificationService } from '../notification/notification.service'

type ComplianceTrigger = 'manual' | 'scheduled'

type ComplianceCheck = {
  key: string
  label: string
  status: 'documented' | 'automated'
  description: string
  evidence: string
  documentUrl: string
}

type BusinessContinuityPlan = {
  status: 'documented'
  title: string
  owner: string
  version: string
  summary: string
  documentUrl: string
  reviewCadence: string
  testCadence: string
  recoveryObjectives: Array<{ label: string; value: string }>
  controls: string[]
  scenarios: string[]
}

type AccessReviewFinding = {
  severity: AuditSeverity
  title: string
  description: string
  count?: number
}

type TenantAccessReview = {
  tenantId: string
  tenantName: string
  totalUsers: number
  activeUsers: number
  adminUsers: number
  usersWith2FA: number
  activeSessions: number
  staleSessions: number
  inactiveUsersWithAccess: number
}

type RecentAccessReviewRun = {
  id: string
  at: string
  actor: string
  severity: AuditSeverity
  description: string
  tenantName: string | null
}

type AccessReviewPolicy = {
  owner: string
  frequency: string
  schedule: string
  lastRunAt: string | null
  nextReviewAt: string | null
  coverage: {
    usersReviewed: number
    sessionsReviewed: number
    percentage: number
  }
}

type AccessReviewTotals = {
  totalUsers: number
  activeUsers: number
  inactiveUsers: number
  totalMemberships: number
  admins: number
  usersWith2FA: number
  usersPending2FA: number
  activeSessions: number
  revokedSessions: number
  staleUsers: number
  staleSessions: number
  inactiveUsersWithAccess: number
  activeSessionsOnInactiveUsers: number
}

type AccessReviewSummary = {
  policy: AccessReviewPolicy
  totals: AccessReviewTotals
  findings: AccessReviewFinding[]
  recommendations: string[]
  byTenant: TenantAccessReview[]
  recentRuns: RecentAccessReviewRun[]
}

export type ComplianceDashboard = {
  complianceChecks: ComplianceCheck[]
  businessContinuityPlan: BusinessContinuityPlan
  accessReview: AccessReviewSummary
}

const ACCESS_REVIEW_ENTITY = 'seguridad'
const ACCESS_REVIEW_ACTION = 'Revision periodica de accesos'
const ACCESS_REVIEW_LOOKBACK_DAYS = 90
const ACCESS_REVIEW_STALE_SESSION_DAYS = 30
const ACCESS_REVIEW_SCHEDULE = '1 de cada mes a las 08:00 America/Bogota'

type UserComplianceRow = Prisma.UserGetPayload<{
  include: {
    memberships: {
      include: {
        tenant: {
          select: {
            id: true
            name: true
          }
        }
      }
    }
    securityProfile: true
  }
}>

type SessionComplianceRow = Prisma.UserSessionGetPayload<{
  include: {
    tenant: {
      select: {
        id: true
        name: true
      }
    }
    user: {
      select: {
        id: true
        status: true
      }
    }
  }
}>

const DAY_IN_MS = 24 * 60 * 60 * 1000

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_IN_MS)
}

function isBeforeThreshold(value: Date | string | null | undefined, threshold: Date) {
  if (!value) {
    return true
  }

  const date = value instanceof Date ? value : new Date(value)
  return date.getTime() < threshold.getTime()
}

function normalizeText(value: string) {
  return String(value || '').trim()
}

function isAdminMembership(role: string) {
  return normalizeText(role).toLowerCase() === 'administrador'
}

function createPlainObject<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async getAllTenants() {
    return this.prisma.tenant.findMany({
      include: {
        _count: {
          select: {
            memberships: true,
            products: true,
            invoices: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      include: {
        memberships: {
          include: { tenant: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getGlobalAuditLogs() {
    return this.prisma.auditEvent.findMany({
      take: 100,
      orderBy: { at: 'desc' },
      include: {
        tenant: { select: { name: true } },
        actorUser: { select: { name: true, email: true } },
      },
    })
  }

  async getSystemStats() {
    const [tenants, users, invoices, movements, demoRequests, subscriptions] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.invoice.count(),
      this.prisma.inventoryMovement.count(),
      this.prisma.demoRequest.count(),
      this.prisma.subscription.count(),
    ])

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [demoRequestsToday, demoRequestsConverted] = await Promise.all([
      this.prisma.demoRequest.count({
        where: {
          createdAt: { gte: today },
        },
      }),
      this.prisma.demoRequest.count({
        where: {
          estado: 'convertido',
        },
      }),
    ])

    const activeTrials = await this.prisma.subscription.count({
      where: {
        planType: 'trial',
        active: true,
        trialEndsAt: { gte: new Date() },
      },
    })

    return {
      totalTenants: tenants,
      totalUsers: users,
      totalInvoices: invoices,
      totalMovements: movements,
      totalDemoRequests: demoRequests,
      demoRequestsToday,
      demoRequestsConverted,
      totalSubscriptions: subscriptions,
      activeTrials,
      systemStatus: 'healthy',
      version: '1.0.0-enterprise',
    }
  }

  async getTenantDetails(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        subscription: true,
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true,
                createdAt: true,
                title: true,
              },
            },
          },
        },
        _count: {
          select: {
            invoices: true,
            products: true,
            ledgerEntries: true,
            ocrRuns: true,
            auditEvents: true,
          },
        },
      },
    })
    if (!tenant) throw new NotFoundException('Empresa no encontrada.')
    return tenant
  }

  async updateTenant(id: string, data: {
    name?: string
    sector?: string
    city?: string
    costMethod?: string
    allowNegativeStock?: boolean
    smtpHost?: string
    smtpPort?: number
    smtpUser?: string
    smtpPassword?: string
    smtpFromEmail?: string
  }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Empresa no encontrada.')
    return this.prisma.tenant.update({ where: { id }, data })
  }

  async updateSubscription(tenantId: string, data: {
    planType?: string
    active?: boolean
    trialEndsAt?: string | null
  }) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } })
    if (!sub) {
      return this.prisma.subscription.create({
        data: {
          tenantId,
          planType: data.planType || 'trial',
          active: data.active ?? true,
          trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : null,
        },
      })
    }
    return this.prisma.subscription.update({
      where: { tenantId },
      data: {
        planType: data.planType ?? sub.planType,
        active: data.active ?? sub.active,
        trialEndsAt: data.trialEndsAt !== undefined
          ? (data.trialEndsAt ? new Date(data.trialEndsAt) : null)
          : sub.trialEndsAt,
      },
    })
  }

  async updateTenantStatus(id: string, status: 'active' | 'suspended') {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Empresa no encontrada.')
    return this.prisma.tenant.update({
      where: { id },
      data: { dianStatus: status },
    })
  }

  async deleteTenant(id: string, actorUserId: string, password?: string) {
    if (!password) throw new UnauthorizedException('Se requiere la contraseña para confirmar esta acción.')
    
    const actorUser = await this.prisma.user.findUnique({ where: { id: actorUserId } })
    if (!actorUser) throw new NotFoundException('Usuario administrador no encontrado.')
    
    // Verificar contraseña usando bcryptjs (usamos compare asíncrono igual que en login)
    if (!actorUser.passwordHash) {
      throw new UnauthorizedException('El usuario no tiene una contraseña válida configurada.')
    }
    const isValid = await compare(password, actorUser.passwordHash)
    if (!isValid) throw new UnauthorizedException('La contraseña proporcionada es incorrecta.')

    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Empresa no encontrada.')

    // Find users that belong ONLY to this tenant (no other memberships)
    const memberships = await this.prisma.membership.findMany({
      where: { tenantId: id },
      select: { userId: true },
    })
    const userIds = memberships.map((m) => m.userId)

    const exclusiveUserIds: string[] = []
    for (const userId of userIds) {
      const otherMemberships = await this.prisma.membership.count({
        where: { userId, tenantId: { not: id } },
      })
      if (otherMemberships === 0) exclusiveUserIds.push(userId)
    }

    return this.prisma.$transaction(async (tx) => {
      if (exclusiveUserIds.length > 0) {
        await tx.userSecurityProfile.deleteMany({ where: { userId: { in: exclusiveUserIds } } })
        await tx.membership.deleteMany({ where: { tenantId: id } })
        await tx.user.deleteMany({ where: { id: { in: exclusiveUserIds } } })
      }
      return tx.tenant.delete({ where: { id } })
    })
  }

  async createCompany(data: {
    name: string
    adminName: string
    adminEmail: string
    prefix?: string
    plan?: string
    city?: string
    nit?: string
    address?: string
    phone?: string
    sector?: string
  }) {
    // 128 bits de entropía — sin sufijo fijo ni patrón predecible
    const tempPassword = randomBytes(16).toString('base64url')
    const passwordHash = hashSync(tempPassword, 12)

    const prefix = data.prefix || data.name.slice(0, 3).toUpperCase()

    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.name,
        prefix,
        city: data.city || null,
        nit: data.nit || null,
        address: data.address || null,
        phone: data.phone || null,
        sector: data.sector || null,
        securitySettings: {},
      },
    })

    const user = await this.prisma.user.create({
      data: {
        name: data.adminName,
        email: data.adminEmail,
        title: 'Administrador',
        passwordHash,
        status: 'active',
      },
    })

    await this.prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: 'Administrador' },
    })

    await this.prisma.userSecurityProfile.create({
      data: {
        userId: user.id,
        passwordResetRequired: true,
        passwordHistory: [],
        trustedFingerprints: [],
      },
    })

    if (data.plan) {
      await this.prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planType: data.plan,
          active: true,
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    }

    return { tenant, user, tempPassword }
  }

  async getComplianceDashboard(): Promise<ComplianceDashboard> {
    const [tenants, users, sessions, reviewRuns] = (await Promise.all([
      this.prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.user.findMany({
        include: {
          memberships: {
            include: {
              tenant: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          securityProfile: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userSession.findMany({
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
      }),
      this.prisma.auditEvent.findMany({
        where: {
          entity: ACCESS_REVIEW_ENTITY,
          action: ACCESS_REVIEW_ACTION,
        },
        take: 5,
        orderBy: { at: 'desc' },
        include: {
          actorUser: { select: { name: true } },
          tenant: { select: { name: true } },
        },
      }),
    ])) as [
      Array<{ id: string; name: string }>,
      UserComplianceRow[],
      SessionComplianceRow[],
      Array<{
        id: string
        at: Date
        actor: string
        severity: AuditSeverity
        description: string
        actorUser: { name: string } | null
        tenant: { name: string } | null
      }>,
    ]

    const now = new Date()
    const staleUserThreshold = addDays(now, -ACCESS_REVIEW_LOOKBACK_DAYS)
    const staleSessionThreshold = addDays(now, -ACCESS_REVIEW_STALE_SESSION_DAYS)
    const tenantMap = new Map<string, TenantAccessReview>(
      tenants.map((tenant) => [
        tenant.id,
        {
          tenantId: tenant.id,
          tenantName: tenant.name,
          totalUsers: 0,
          activeUsers: 0,
          adminUsers: 0,
          usersWith2FA: 0,
          activeSessions: 0,
          staleSessions: 0,
          inactiveUsersWithAccess: 0,
        },
      ]),
    )

    const userMap = new Map(users.map((user) => [user.id, user]))
    const totals: AccessReviewTotals = {
      totalUsers: users.length,
      activeUsers: 0,
      inactiveUsers: 0,
      totalMemberships: 0,
      admins: 0,
      usersWith2FA: 0,
      usersPending2FA: 0,
      activeSessions: 0,
      revokedSessions: 0,
      staleUsers: 0,
      staleSessions: 0,
      inactiveUsersWithAccess: 0,
      activeSessionsOnInactiveUsers: 0,
    }

    const recommendations = new Set<string>()

    for (const user of users) {
      const memberships = user.memberships || []
      const has2FA = Boolean(user.securityProfile?.twoFactorEnabled)
      const isActive = user.status === UserStatus.active
      const isStale = isActive && isBeforeThreshold(user.lastLoginAt, staleUserThreshold)

      totals.totalMemberships += memberships.length

      if (isActive) {
        totals.activeUsers += 1
      } else {
        totals.inactiveUsers += 1
        if (memberships.length > 0) {
          totals.inactiveUsersWithAccess += 1
        }
      }

      if (has2FA) {
        totals.usersWith2FA += 1
      } else if (isActive) {
        totals.usersPending2FA += 1
      }

      if (isStale) {
        totals.staleUsers += 1
      }

      const isAdmin = user.isSystemOwner || memberships.some((membership) => isAdminMembership(membership.role))
      if (isAdmin) {
        totals.admins += 1
      }

      for (const membership of memberships) {
        const tenantSummary = tenantMap.get(membership.tenantId)
        if (!tenantSummary) {
          continue
        }

        tenantSummary.totalUsers += 1
        if (isActive) {
          tenantSummary.activeUsers += 1
        } else {
          tenantSummary.inactiveUsersWithAccess += 1
        }

        if (has2FA) {
          tenantSummary.usersWith2FA += 1
        }

        if (isAdminMembership(membership.role)) {
          tenantSummary.adminUsers += 1
        }
      }
    }

    for (const session of sessions) {
      const tenantSummary = tenantMap.get(session.tenantId)
      const isActiveSession = !session.revokedAt
      const isStaleSession = isActiveSession && isBeforeThreshold(session.lastSeenAt, staleSessionThreshold)
      const sessionUser = session.user ? userMap.get(session.user.id) : null
      const isInactiveUserSession = isActiveSession && sessionUser?.status === UserStatus.inactive

      if (isActiveSession) {
        totals.activeSessions += 1
        if (isInactiveUserSession) {
          totals.activeSessionsOnInactiveUsers += 1
        }
      } else {
        totals.revokedSessions += 1
      }

      if (isStaleSession) {
        totals.staleSessions += 1
      }

      if (tenantSummary) {
        if (isActiveSession) {
          tenantSummary.activeSessions += 1
        }

        if (isStaleSession) {
          tenantSummary.staleSessions += 1
        }
      }
    }

    if (totals.inactiveUsersWithAccess > 0) {
      recommendations.add('Revocar las membresias de usuarios inactivos y dejar evidencia del cierre.')
    }

    if (totals.usersPending2FA > 0) {
      recommendations.add('Exigir 2FA en cuentas privilegiadas y cerrar la brecha en las cuentas restantes.')
    }

    if (totals.staleUsers > 0) {
      recommendations.add('Confirmar si los usuarios sin actividad reciente siguen necesitando acceso.')
    }

    if (totals.staleSessions > 0 || totals.activeSessionsOnInactiveUsers > 0) {
      recommendations.add('Cerrar sesiones obsoletas y validar dispositivos confiables antes de la siguiente revision.')
    }

    recommendations.add('Conservar la evidencia de la revision en el log de auditoria y en el procedimiento ISO.')

    const findings: AccessReviewFinding[] = []

    if (!totals.totalUsers) {
      findings.push({
        severity: AuditSeverity.info,
        title: 'Sin usuarios para revisar',
        description: 'Todavia no hay cuentas cargadas en la plataforma para esta revision.',
      })
    }

    if (totals.inactiveUsersWithAccess > 0) {
      findings.push({
        severity: AuditSeverity.warning,
        title: 'Usuarios inactivos con acceso',
        description: `${totals.inactiveUsersWithAccess} usuario(s) inactivo(s) aun conservan membresias activas.`,
        count: totals.inactiveUsersWithAccess,
      })
    }

    if (totals.usersPending2FA > 0) {
      findings.push({
        severity: AuditSeverity.warning,
        title: 'Usuarios activos sin 2FA',
        description: `${totals.usersPending2FA} usuario(s) activos siguen sin autentificacion de dos factores.`,
        count: totals.usersPending2FA,
      })
    }

    if (totals.staleUsers > 0) {
      findings.push({
        severity: AuditSeverity.info,
        title: 'Usuarios sin actividad reciente',
        description: `${totals.staleUsers} usuario(s) activos no han iniciado sesion en los ultimos 90 dias.`,
        count: totals.staleUsers,
      })
    }

    if (totals.staleSessions > 0) {
      findings.push({
        severity: AuditSeverity.info,
        title: 'Sesiones activas obsoletas',
        description: `${totals.staleSessions} sesion(es) activas no registran actividad reciente.`,
        count: totals.staleSessions,
      })
    }

    if (totals.activeSessionsOnInactiveUsers > 0) {
      findings.push({
        severity: AuditSeverity.warning,
        title: 'Sesiones activas en cuentas inactivas',
        description: `${totals.activeSessionsOnInactiveUsers} sesion(es) activas pertenecen a cuentas inactivas.`,
        count: totals.activeSessionsOnInactiveUsers,
      })
    }

    if (!findings.length) {
      findings.push({
        severity: AuditSeverity.info,
        title: 'Sin hallazgos relevantes',
        description: 'La ultima revision automatizada no encontro desviaciones relevantes.',
      })
    }

    const recentRuns: RecentAccessReviewRun[] = reviewRuns.map((run) => ({
      id: run.id,
      at: run.at.toISOString(),
      actor: run.actorUser?.name || run.actor,
      severity: run.severity,
      description: run.description,
      tenantName: run.tenant?.name || null,
    }))

    const lastRunAt = recentRuns[0]?.at || null
    const nextReviewAt = toIso(lastRunAt ? addDays(new Date(lastRunAt), 30) : addDays(now, 30))

    return createPlainObject({
      complianceChecks: [
        {
          key: 'business-continuity-plan',
          label: 'Plan de continuidad del negocio',
          status: 'documented',
          description: 'Documento operativo listo con objetivos de recuperacion, responsables y controles minimos.',
          evidence: 'Existe documentacion publica en el portal y un plan de restauracion definido.',
          documentUrl: '/compliance/business-continuity-plan.md',
        },
        {
          key: 'access-review',
          label: 'Revision periodica de accesos',
          status: 'automated',
          description: 'Revision mensual automatizada con ejecucion manual desde la consola de administracion.',
          evidence: `Ultima ejecucion ${lastRunAt ? new Date(lastRunAt).toLocaleString('es-CO') : 'sin ejecutar aun'}.`,
          documentUrl: '/compliance/access-review-procedure.md',
        },
      ] satisfies ComplianceCheck[],
      businessContinuityPlan: {
        status: 'documented',
        title: 'Plan de continuidad del negocio',
        owner: 'Direccion de TI y Operaciones',
        version: '1.0',
        summary: 'Define como mantener o restaurar el ERP, la autenticacion, la API y la base de datos despues de una interrupcion critica.',
        documentUrl: '/compliance/business-continuity-plan.md',
        reviewCadence: 'Semestral y despues de cambios mayores',
        testCadence: 'Prueba de restauracion mensual',
        recoveryObjectives: [
          { label: 'RTO', value: '4 horas' },
          { label: 'RPO', value: '30 minutos' },
          { label: 'Prueba', value: 'Mensual' },
        ],
        controls: [
          'Respaldos diarios de la base de datos',
          'Prueba de restauracion mensual',
          'Monitoreo de disponibilidad y autenticacion',
          'Registro de incidentes y evidencias en auditoria',
        ],
        scenarios: [
          'Caida total de la API',
          'Perdida de acceso a la base de datos',
          'Error critico de autenticacion',
          'Despliegue fallido en produccion',
        ],
      },
      accessReview: {
        policy: {
          owner: 'Seguridad y Administracion',
          frequency: 'Mensual',
          schedule: ACCESS_REVIEW_SCHEDULE,
          lastRunAt,
          nextReviewAt,
          coverage: {
            usersReviewed: totals.totalUsers,
            sessionsReviewed: sessions.length,
            percentage: totals.totalUsers > 0 ? 100 : 0,
          },
        },
        totals,
        findings,
        recommendations: Array.from(recommendations),
        byTenant: Array.from(tenantMap.values()),
        recentRuns,
      },
    })
  }

  async runAccessReview(trigger: ComplianceTrigger, actorUserId?: string) {
    const dashboard = await this.getComplianceDashboard()
    const actorUser = actorUserId
      ? await this.prisma.user.findUnique({
          where: { id: actorUserId },
          select: { name: true },
        })
      : null

    const description = this.buildAccessReviewDescription(dashboard)
    const severity = dashboard.accessReview.findings.some((finding) => finding.severity === AuditSeverity.warning)
      ? AuditSeverity.warning
      : AuditSeverity.info

    await this.prisma.auditEvent.create({
      data: {
        entity: ACCESS_REVIEW_ENTITY,
        action: ACCESS_REVIEW_ACTION,
        description,
        actor: trigger === 'scheduled' ? 'Sistema programado' : actorUser?.name || 'Administrador',
        actorUserId: actorUserId || null,
        severity,
      },
    })

    return this.getComplianceDashboard()
  }

  async eraseUserData(userId: string, actorUserId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new Error(`Usuario ${userId} no encontrado.`)
    }

    const anonymizedEmail = `erased_${createHash('sha256').update(user.email).digest('hex').slice(0, 16)}@erased.local`

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          name: '[eliminado]',
          email: anonymizedEmail,
          passwordHash: null,
          passwordSalt: null,
          title: '[eliminado]',
          status: UserStatus.inactive,
        },
      }),
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actorUserId },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditEvent.create({
        data: {
          entity: 'usuario',
          action: 'Derecho al olvido ejercido',
          description: `Datos personales del usuario ${userId} anonimizados en cumplimiento del Art. 15 Ley 1581 de 2012.`,
          actor: actorUserId,
          actorUserId,
          severity: AuditSeverity.warning,
        },
      }),
    ])

    return { ok: true, message: 'Datos del usuario anonimizados correctamente.' }
  }

  async getBreachAlerts() {
    return this.prisma.auditEvent.findMany({
      where: { severity: { in: [AuditSeverity.error, AuditSeverity.critical] } },
      orderBy: { at: 'desc' },
      take: 50,
      include: {
        actorUser: { select: { name: true, email: true } },
        tenant: { select: { name: true } },
      },
    })
  }

  async notifyBreach(auditEventId: string) {
    const event = await this.prisma.auditEvent.findUnique({
      where: { id: auditEventId },
      include: { actorUser: { select: { name: true } } },
    })
    if (!event) throw new Error('Evento no encontrado.')

    const admins = await this.prisma.user.findMany({
      where: { isSystemOwner: true, status: UserStatus.active },
      select: { email: true },
    })

    await this.notifications.sendBreachAlert({
      eventId: event.id,
      severity: event.severity,
      entity: event.entity,
      action: event.action,
      description: event.description,
      actor: event.actorUser?.name ?? event.actor,
      occurredAt: event.at,
      adminEmails: admins.map((a) => a.email),
    })

    return { ok: true, message: `Alerta enviada a ${admins.length} administrador(es).` }
  }

  private buildAccessReviewDescription(dashboard: ComplianceDashboard) {
    const totals = dashboard.accessReview.totals
    const highlights = [
      totals.inactiveUsersWithAccess > 0 ? `${totals.inactiveUsersWithAccess} inactivos con acceso` : null,
      totals.usersPending2FA > 0 ? `${totals.usersPending2FA} cuentas sin 2FA` : null,
      totals.staleSessions > 0 ? `${totals.staleSessions} sesiones obsoletas` : null,
      totals.activeSessionsOnInactiveUsers > 0 ? `${totals.activeSessionsOnInactiveUsers} sesiones en cuentas inactivas` : null,
    ].filter(Boolean)

    const prefix = `Revision periodica ejecutada. Usuarios=${totals.totalUsers}, activos=${totals.activeUsers}, inactivos=${totals.inactiveUsers}.`
    const middle = highlights.length ? ` Hallazgos: ${highlights.join(', ')}.` : ' Sin hallazgos relevantes.'

    return `${prefix}${middle}`
  }
}
