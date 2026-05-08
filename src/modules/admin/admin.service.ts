import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
    const [tenants, users, invoices, movements] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.invoice.count(),
      this.prisma.inventoryMovement.count(),
    ])

    return {
      totalTenants: tenants,
      totalUsers: users,
      totalInvoices: invoices,
      totalMovements: movements,
      systemStatus: 'healthy',
      version: '1.0.0-enterprise',
    }
  }
}
