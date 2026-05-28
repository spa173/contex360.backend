import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record({
    tenantId,
    entity,
    action,
    description,
    actor,
    actorUserId,
    severity = 'info',
  }: {
    tenantId?: string;
    entity: string;
    action: string;
    description: string;
    actor: string;
    actorUserId?: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  }) {
    try {
      await this.prisma.auditEvent.create({
        data: {
          tenantId,
          entity,
          action,
          description,
          actor,
          actorUserId,
          severity,
        },
      });
    } catch (e) {
      this.logger.error('Audit record failed', e);
    }
  }

  async getAuditLogs(tenantId?: string, limit = 100) {
    return this.prisma.auditEvent.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
