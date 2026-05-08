import { Test, TestingModule } from '@nestjs/testing'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { AdminService } from './admin.service'
import { PrismaService } from '../database/prisma.service'

describe('AdminService', () => {
  let service: AdminService

  const mockPrismaService = {
    tenant: {
      findMany: vi.fn().mockResolvedValue([{ id: 't1' }]),
      count: vi.fn().mockResolvedValue(10),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'u1' }]),
      count: vi.fn().mockResolvedValue(50),
    },
    auditEvent: {
      findMany: vi.fn().mockResolvedValue([{ action: 'test' }]),
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
})
