import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import * as crypto from 'crypto';
import { CONTRATOS_LEGALES } from './legal-texts';

@Injectable()
export class ContratosService {
  private readonly logger = new Logger(ContratosService.name);
  constructor(private readonly prisma: PrismaService) {}

  async crearContrato(data: {
    tenantId?: string;
    tipo: string;
    version: string;
    titulo: string;
    cuerpo: string;
  }) {
    const hash = crypto.createHash('sha256').update(data.cuerpo).digest('hex');
    return this.prisma.contrato.create({
      data: {
        tenantId: data.tenantId,
        tipo: data.tipo as any,
        version: data.version,
        titulo: data.titulo,
        cuerpo: data.cuerpo,
        hash,
        publicadoEn: new Date(),
      },
    });
  }

  async getContratos(tenantId?: string) {
    return this.prisma.contrato.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async getContratoActivo(tenantId: string, tipo: string) {
    return this.prisma.contrato.findFirst({
      where: { tenantId, tipo: tipo as any },
      orderBy: { version: 'desc' },
    });
  }

  async aceptarContrato(contratoId: string, userId: string, tenantId: string, ip?: string, dispositivo?: string) {
    const contrato = await this.prisma.contrato.findUnique({ where: { id: contratoId } });
    if (!contrato) throw new Error('Contrato no encontrado');

    const firma = crypto.createHash('sha256').update(`${contratoId}_${userId}_${Date.now()}`).digest('hex');

    return this.prisma.contratoAceptacion.create({
      data: {
        contratoId,
        userId,
        tenantId,
        firma,
        ip,
        dispositivo,
        aceptadoEn: new Date(),
      },
    });
  }

  async getAceptaciones(contratoId: string) {
    return this.prisma.contratoAceptacion.findMany({
      where: { contratoId },
      include: { user: { select: { name: true, email: true } } },
    });
  }

  async verificarAceptacion(contratoId: string, userId: string): Promise<boolean> {
    const aceptacion = await this.prisma.contratoAceptacion.findUnique({
      where: { contratoId_userId: { contratoId, userId } },
    });
    return !!aceptacion;
  }

  async seedContratosPredeterminados(tenantId: string) {
    const creados: string[] = [];
    for (const contrato of CONTRATOS_LEGALES) {
      const existente = await this.prisma.contrato.findFirst({
        where: { tenantId, tipo: contrato.tipo as any, version: contrato.version },
      });
      if (!existente) {
        await this.crearContrato({ tenantId, ...contrato });
        creados.push(contrato.tipo);
      }
    }
    return { creados, message: `${creados.length} contratos creados para el tenant` };
  }

  async pendientes(tenantId: string, userId: string) {
    const tipos: string[] = (await this.prisma.contrato.groupBy({
      by: ['tipo'],
      where: { tenantId },
    })).map(t => t.tipo);

    const pendientes: any[] = [];
    for (const tipo of tipos) {
      const ultimo = await this.prisma.contrato.findFirst({
        where: { tenantId, tipo: tipo as any },
        orderBy: { createdAt: 'desc' },
      });
      if (!ultimo) continue;
      const acepto = await this.prisma.contratoAceptacion.findFirst({
        where: { contratoId: ultimo.id, userId },
      });
      if (!acepto) pendientes.push(ultimo);
    }
    return pendientes;
  }

  async ultimoPorTipo(tenantId: string, tipo: string) {
    return this.prisma.contrato.findFirst({
      where: { tenantId, tipo: tipo as any },
      orderBy: { createdAt: 'desc' },
    });
  }
}
