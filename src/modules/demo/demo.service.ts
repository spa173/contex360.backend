import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';

function safeLogMessage(value: unknown): string {
  if (value instanceof Error) {
    return (value.message || value.name).replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
  }
  if (typeof value === 'string') {
    return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
  }
  const stringified = value === null || value === undefined ? '' : String(value);
  return stringified.replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
}

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async createDemoRequest(data: {
    nombre: string;
    empresa: string;
    correo: string;
    telefono?: string;
    mensaje?: string;
    nit?: string;
    ciudad?: string;
    direccion?: string;
    sector?: string;
  }) {
    const demoRequest = await this.prisma.demoRequest.create({
      data: {
        nombre: data.nombre,
        empresa: data.empresa,
        correo: data.correo,
        telefono: data.telefono,
        mensaje: data.mensaje,
        nit: data.nit,
        ciudad: data.ciudad,
        direccion: data.direccion,
        sector: data.sector,
        estado: 'nuevo',
      },
    });

    // Send Email notification to System Owner
    const systemOwner = await this.prisma.user.findFirst({
      where: { isSystemOwner: true },
    });

    if (systemOwner) {
      setImmediate(() => {
        this.notificationService.sendDemoRequestEmail(data, systemOwner.email).catch((err) => {
          console.error('Failed to send Email notification:', safeLogMessage(err));
        });
      });
    }

    return {
      ok: true,
      message: 'Solicitud enviada correctamente. Nuestro equipo te contactará pronto.',
      data: demoRequest,
    };
  }

  async getAllDemoRequests() {
    const requests = await this.prisma.demoRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      ok: true,
      data: requests,
    };
  }

  async updateDemoRequestStatus(id: string, estado: string) {
    const request = await this.prisma.demoRequest.update({
      where: { id },
      data: { estado: estado as any },
    });

    return {
      ok: true,
      data: request,
    };
  }

  async convertToCustomer(id: string) {
    const demoRequest = await this.prisma.demoRequest.findUnique({
      where: { id },
    });

    if (!demoRequest) {
      throw new ConflictException('Solicitud no encontrada');
    }

    if (demoRequest.estado === 'convertido') {
      throw new ConflictException('Esta solicitud ya ha sido convertida');
    }

    // Generate temporary password
    const tempPassword = this.generateTempPassword();
    const passwordHash = await hash(tempPassword, 12);

    // Generate tenant prefix from company name
    const prefix = this.generatePrefix(demoRequest.empresa);

    // Create tenant, user, and membership in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Check if prefix already exists
      const existingTenant = await tx.tenant.findUnique({
        where: { prefix },
      });

      if (existingTenant) {
        throw new ConflictException(`El prefijo ${prefix} ya está en uso`);
      }

      // Check if email already exists
      const existingUser = await tx.user.findUnique({
        where: { email: demoRequest.correo },
      });

      if (existingUser) {
        throw new ConflictException(`El correo ${demoRequest.correo} ya está registrado`);
      }

      // Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: demoRequest.empresa,
          prefix,
          nit: demoRequest.nit,
          address: demoRequest.direccion,
          phone: demoRequest.telefono,
          sector: demoRequest.sector,
          city: demoRequest.ciudad,
          securitySettings: {},
        },
      });

      // Create user
      const user = await tx.user.create({
        data: {
          name: demoRequest.nombre,
          email: demoRequest.correo,
          title: 'Administrador',
          passwordHash,
        },
      });

      // Create security profile with password reset required
      await tx.userSecurityProfile.create({
        data: {
          userId: user.id,
          passwordResetRequired: true,
          riskLevel: 'low',
          passwordHistory: [],
          trustedFingerprints: [],
        },
      });

      // Create membership
      await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: 'owner',
        },
      });

      // Create subscription with 14-day trial
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planType: 'trial',
          active: true,
          trialEndsAt,
        },
      });

      // Update demo request status
      await tx.demoRequest.update({
        where: { id },
        data: { estado: 'convertido' },
      });

      return { tenant, user, tempPassword };
    });

    // Send Welcome Email with credentials to the final user in the background
    setImmediate(() => {
      this.notificationService.sendWelcomeCredentialsEmail({
        email: result.user.email,
        name: result.user.name,
        tempPassword: result.tempPassword,
        companyName: result.tenant.name,
        prefix: result.tenant.prefix,
      }).catch((err) => {
        console.error('Failed to send Welcome Email:', safeLogMessage(err));
      });
    });

    return {
      ok: true,
      message: 'Cliente creado exitosamente',
      data: {
        tenant: result.tenant,
        user: result.user,
        tempPassword: result.tempPassword,
      },
    };
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
    const bytes = randomBytes(12);
    let password = '';
    for (const byte of bytes) {
      password += chars.charAt(byte % chars.length);
    }
    return password;
  }

  private generatePrefix(companyName: string): string {
    return companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 10);
  }
}
