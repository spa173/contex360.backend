import { Test, TestingModule } from '@nestjs/testing'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { AdminService } from './admin.service'
import { PrismaService } from '../database/prisma.service'

describe('AdminService', () => {
  let service: AdminService

  const now = new Date('2026-05-12T12:00:00.000Z')
  const activeRecent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
  const activeStale = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000)
  const staleSessionDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)
  const reviewDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)

  const mockReviewRuns = [
    {
      id: 'log-1',
      at: reviewDate,
      actor: 'Ana Admin',
      severity: 'warning',
      description: 'Revision periodica ejecutada. Usuarios=3, activos=2, inactivos=1.',
      actorUser: { name: 'Ana Admin' },
      tenant: null,
    },
    {
      id: 'log-2',
      at: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
      actor: 'Sistema programado',
      severity: 'info',
      description: 'Revision periodica ejecutada. Sin hallazgos relevantes.',
      actorUser: null,
      tenant: null,
    },
  ]

  const mockPrismaService = {
    tenant: {
      findMany: vi.fn().mockImplementation((args) =>
        args?.select
          ? [
              { id: 'tenant-1', name: 'Alpha' },
              { id: 'tenant-2', name: 'Beta' },
            ]
          : [{ id: 't1' }],
      ),
      count: vi.fn().mockResolvedValue(10),
    },
    user: {
      findMany: vi.fn().mockImplementation((args) =>
        args?.include?.securityProfile
          ? [
              {
                id: 'u1',
                name: 'Ana Admin',
                email: 'ana@alpha.com',
                status: 'active',
                lastLoginAt: activeRecent,
                isSystemOwner: false,
                memberships: [
                  {
                    id: 'm1',
                    tenantId: 'tenant-1',
                    role: 'Administrador',
                    tenant: { id: 'tenant-1', name: 'Alpha' },
                  },
                ],
                securityProfile: { twoFactorEnabled: true },
              },
              {
                id: 'u2',
                name: 'Bruno Inactivo',
                email: 'bruno@alpha.com',
                status: 'inactive',
                lastLoginAt: activeStale,
                isSystemOwner: false,
                memberships: [
                  {
                    id: 'm2',
                    tenantId: 'tenant-1',
                    role: 'Visor',
                    tenant: { id: 'tenant-1', name: 'Alpha' },
                  },
                ],
                securityProfile: { twoFactorEnabled: false },
              },
              {
                id: 'u3',
                name: 'Carla Sin 2FA',
                email: 'carla@beta.com',
                status: 'active',
                lastLoginAt: activeStale,
                isSystemOwner: false,
                memberships: [
                  {
                    id: 'm3',
                    tenantId: 'tenant-2',
                    role: 'Contador',
                    tenant: { id: 'tenant-2', name: 'Beta' },
                  },
                ],
                securityProfile: { twoFactorEnabled: false },
              },
            ]
          : [{ id: 'u1' }],
      ),
      count: vi.fn().mockResolvedValue(50),
      findUnique: vi.fn().mockResolvedValue({ name: 'Admin User' }),
    },
    userSession: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 's1',
          tenantId: 'tenant-1',
          lastSeenAt: activeRecent,
          revokedAt: null,
          user: { id: 'u1', status: 'active' },
          tenant: { id: 'tenant-1', name: 'Alpha' },
        },
        {
          id: 's2',
          tenantId: 'tenant-1',
          lastSeenAt: staleSessionDate,
          revokedAt: null,
          user: { id: 'u2', status: 'inactive' },
          tenant: { id: 'tenant-1', name: 'Alpha' },
        },
        {
          id: 's3',
          tenantId: 'tenant-2',
          lastSeenAt: activeRecent,
          revokedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          user: { id: 'u3', status: 'active' },
          tenant: { id: 'tenant-2', name: 'Beta' },
        },
      ]),
    },
    auditEvent: {
      findMany: vi.fn().mockImplementation((args) => (args?.where ? mockReviewRuns : [{ action: 'test' }])),
      create: vi.fn().mockResolvedValue({ id: 'new-review' }),
    },
    invoice: {
      count: vi.fn().mockResolvedValue(100),
    },
    inventoryMovement: {
      count: vi.fn().mockResolvedValue(200),
    },
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile()

    service = module.get<AdminService>(AdminService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('getAllTenants returns tenants', async () => {
    const res = await service.getAllTenants()
    expect(res).toEqual([{ id: 't1' }])
    expect(mockPrismaService.tenant.findMany).toHaveBeenCalled()
  })

  it('getAllUsers returns users', async () => {
    const res = await service.getAllUsers()
    expect(res).toEqual([{ id: 'u1' }])
    expect(mockPrismaService.user.findMany).toHaveBeenCalled()
  })

  it('getGlobalAuditLogs returns logs', async () => {
    const res = await service.getGlobalAuditLogs()
    expect(res).toEqual([{ action: 'test' }])
    expect(mockPrismaService.auditEvent.findMany).toHaveBeenCalled()
  })

  it('getSystemStats returns counts', async () => {
    const res = await service.getSystemStats()
    expect(res).toMatchObject({
      totalTenants: 10,
      totalUsers: 50,
      totalInvoices: 100,
      totalMovements: 200,
      systemStatus: 'healthy',
      version: '1.0.0-enterprise',
    })
  })

  it('getComplianceDashboard computes access review data', async () => {
    const res = await service.getComplianceDashboard()

    expect(res.businessContinuityPlan.status).toBe('documented')
    expect(res.complianceChecks).toHaveLength(2)
    expect(res.accessReview.totals).toMatchObject({
      totalUsers: 3,
      activeUsers: 2,
      inactiveUsers: 1,
      totalMemberships: 3,
      admins: 1,
      usersWith2FA: 1,
      usersPending2FA: 1,
      activeSessions: 2,
      revokedSessions: 1,
      staleUsers: 1,
      staleSessions: 1,
      inactiveUsersWithAccess: 1,
      activeSessionsOnInactiveUsers: 1,
    })
    expect(res.accessReview.findings.some((finding) => finding.severity === 'warning')).toBe(true)
    expect(res.accessReview.byTenant).toHaveLength(2)
    expect(res.accessReview.recentRuns).toHaveLength(2)
    expect(res.accessReview.policy.coverage.percentage).toBe(100)
  })

  it('runAccessReview records audit evidence and refreshes the dashboard', async () => {
    const res = await service.runAccessReview('manual', 'u1')

    expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { name: true },
    })
    expect(mockPrismaService.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: 'seguridad',
          action: 'Revision periodica de accesos',
          actor: 'Admin User',
          actorUserId: 'u1',
          severity: 'warning',
        }),
      }),
    )
    expect(res.accessReview.totals.totalUsers).toBe(3)
  })
})
