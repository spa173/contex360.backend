import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrarConsentimiento(tenantId: string, userId: string, type: any, estado: any) {
    return this.prisma.consentimiento.create({
      data: {
        tenantId,
        userId,
        type,
        estado,
        fecha: new Date(),
        hashConsent: this.generateHash(),
      },
    });
  }

  async getConsentimientos(tenantId: string, userId?: string) {
    return this.prisma.consentimiento.findMany({
      where: {
        tenantId,
        ...(userId && { userId }),
      },
      orderBy: { fecha: 'desc' },
    });
  }

  async createSolicitudDerechos(data: {
    tenantId: string;
    userId: string;
    tipo: any;
    solicitante: string;
    emailSolicitante: string;
    ip?: string;
  }) {
    return this.prisma.solicitudDerechos.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        tipo: data.tipo,
        estado: 'recibida',
        solicitante: data.solicitante,
        emailSolicitante: data.emailSolicitante,
        ip: data.ip,
        fechaSolicitud: new Date(),
      },
    });
  }

  async updateSolicitudDerechos(solicitudId: string, estado: any, fechaResolucion?: Date) {
    return this.prisma.solicitudDerechos.update({
      where: { id: solicitudId },
      data: {
        estado,
        fechaResolucion,
      },
    });
  }

  private generateHash(): string {
    return require('crypto').randomBytes(16).toString('hex');
  }
}
