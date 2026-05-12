import { Test, TestingModule } from '@nestjs/testing'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

import { PrismaService } from '../database/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

describe('AdminController', () => {
  let controller: AdminController
  let service: AdminService

  const mockAdminService = {
    getAllTenants: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]),
    getAllUsers: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
    getSystemStats: vi.fn().mockResolvedValue({ totalUsers: 10 }),
    getGlobalAuditLogs: vi.fn().mockResolvedValue([{ action: 'test' }]),
    getComplianceDashboard: vi.fn().mockResolvedValue({ accessReview: { totals: { totalUsers: 1 } } }),
    runAccessReview: vi.fn().mockResolvedValue({ accessReview: { totals: { totalUsers: 1 } } }),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: Reflector, useValue: {} },
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
      ],
    }).compile()

    controller = module.get<AdminController>(AdminController)
    service = module.get<AdminService>(AdminService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call getStats', async () => {
    const res = await controller.getStats()
    expect(res).toEqual({ totalUsers: 10 })
    expect(service.getSystemStats).toHaveBeenCalled()
  })

  it('should call getTenants', async () => {
    const res = await controller.getTenants()
    expect(res).toEqual([{ id: 'tenant-1' }])
    expect(service.getAllTenants).toHaveBeenCalled()
  })

  it('should call getUsers', async () => {
    const res = await controller.getUsers()
    expect(res).toEqual([{ id: 'user-1' }])
    expect(service.getAllUsers).toHaveBeenCalled()
  })

  it('should call getAuditLogs', async () => {
    const res = await controller.getAuditLogs()
    expect(res).toEqual([{ action: 'test' }])
    expect(service.getGlobalAuditLogs).toHaveBeenCalled()
  })

  it('should call getCompliance', async () => {
    const res = await controller.getCompliance()
    expect(res).toEqual({ accessReview: { totals: { totalUsers: 1 } } })
    expect(service.getComplianceDashboard).toHaveBeenCalled()
  })

  it('should run access review with the current user', async () => {
    const res = await controller.runAccessReview({
      authUser: { sub: 'user-1', sessionId: 'session-1', tenantId: 'tenant-1', email: 'admin@contex360.local', isSystemOwner: true },
      headers: {},
    } as any)

    expect(res).toEqual({ accessReview: { totals: { totalUsers: 1 } } })
    expect(service.runAccessReview).toHaveBeenCalledWith('manual', 'user-1')
  })
})
