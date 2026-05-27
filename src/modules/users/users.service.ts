import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import * as crypto from 'crypto'
import * as bcrypt from 'bcryptjs'

export interface CreateUserDto {
  name: string
  email: string
  password?: string
  title?: string
  tenantId?: string
  role?: string
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  generateTemporaryPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?'
    const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?']
    const passwordChars = groups.map(g => g[crypto.randomInt(g.length)])
    while (passwordChars.length < 16) {
      passwordChars.push(chars[crypto.randomInt(chars.length)])
    }
    for (let i = passwordChars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]]
    }
    return passwordChars.join('')
  }

  generateRecoveryCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return Array.from({ length: 10 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')
  }

  async hashPassword(password: string) {
    const salt = await bcrypt.genSalt(10)
    const hash = await bcrypt.hash(password, salt)
    return { hash, salt }
  }

  async findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: {
        memberships: { some: { tenantId } },
      },
      include: {
        memberships: {
          where: { tenantId },
          select: { role: true },
        },
        securityProfile: {
          select: {
            twoFactorEnabled: true,
            twoFactorRequired: true,
            passwordResetRequired: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId } } },
      include: {
        memberships: {
          where: { tenantId },
          select: { role: true, tenant: { select: { name: true } } },
        },
        securityProfile: true,
      },
    })
    if (!user) throw new NotFoundException('Usuario no encontrado')
    return user
  }

  async createUser(dto: CreateUserDto) {
    const normalizedEmail = String(dto.email || '').trim().toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      throw new BadRequestException('El correo ya está registrado.')
    }

    const tempPassword = dto.password || this.generateTemporaryPassword()
    const { hash, salt } = await this.hashPassword(tempPassword)

    return await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: normalizedEmail,
          title: dto.title || '',
          status: 'active',
          isSystemOwner: false,
          isDemoAccount: false,
          passwordHash: hash,
          passwordSalt: salt,
        },
      })

      await tx.userSecurityProfile.create({
        data: {
          userId: user.id,
          passwordResetRequired: true,
          twoFactorEnabled: false,
          twoFactorRequired: false,
          passwordHistory: [],
          trustedFingerprints: [],
        },
      })

      if (dto.tenantId && dto.role) {
        await tx.membership.create({
          data: {
            userId: user.id,
            tenantId: dto.tenantId,
            role: dto.role,
          },
        })
      }

      return { user, tempPassword }
    })
  }

  async toggleStatus(id: string, tenantId: string) {
    const user = await this.findTenantUser(id, tenantId)
    const newStatus = user.status === 'active' ? 'inactive' : 'active'
    await this.prisma.user.update({ where: { id }, data: { status: newStatus } })
    return { ok: true, message: `Usuario ${newStatus === 'active' ? 'activado' : 'desactivado'}.` }
  }

  async forcePasswordReset(id: string, tenantId: string) {
    await this.findTenantUser(id, tenantId)
    await this.prisma.userSecurityProfile.update({
      where: { userId: id },
      data: { passwordResetRequired: true },
    })
    return { ok: true, message: 'Reinicio de contraseña forzado.' }
  }

  async generateAndSetTempPassword(id: string, tenantId: string) {
    await this.findTenantUser(id, tenantId)
    const tempPassword = this.generateTemporaryPassword()
    const { hash, salt } = await this.hashPassword(tempPassword)

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: hash, passwordSalt: salt } }),
      this.prisma.userSecurityProfile.update({
        where: { userId: id },
        data: {
          passwordResetRequired: true,
          tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      }),
    ])

    return { ok: true, message: `Contraseña temporal generada.`, tempPassword, detail: 'Válida por 24h.' }
  }

  async setTwoFactorRequirement(id: string, required: boolean, tenantId: string) {
    await this.findTenantUser(id, tenantId)
    await this.prisma.userSecurityProfile.update({
      where: { userId: id },
      data: { twoFactorRequired: required },
    })
    return { ok: true, message: required ? '2FA requerido.' : '2FA opcional.' }
  }

  async toggleTwoFactor(id: string, tenantId: string) {
    const user = await this.findTenantUser(id, tenantId)
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId: id } })
    const newState = !profile?.twoFactorEnabled
    await this.prisma.userSecurityProfile.update({
      where: { userId: id },
      data: { twoFactorEnabled: newState },
    })
    return { ok: true, message: newState ? '2FA activado.' : '2FA desactivado.' }
  }

  async revokeUserSessions(id: string, tenantId: string) {
    await this.findTenantUser(id, tenantId)
    const result = await this.prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { ok: true, message: `${result.count} sesiones revocadas.` }
  }

  async revokeSession(sessionId: string, tenantId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId },
      include: { user: { include: { memberships: { where: { tenantId } } } } },
    })
    if (!session || session.user.memberships.length === 0) {
      throw new NotFoundException('Sesión no encontrada en este tenant.')
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    })
    return { ok: true, message: 'Sesión terminada.' }
  }

  async panicRevokeAll(tenantId: string) {
    const result = await this.prisma.userSession.updateMany({
      where: {
        tenantId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    })
    return { ok: true, message: `${result.count} sesiones revocadas en el tenant.` }
  }

  async upsertMembership(payload: { userId: string; tenantId: string; role: string }) {
    const existing = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: payload.userId, tenantId: payload.tenantId } },
    })
    if (existing) {
      await this.prisma.membership.update({
        where: { userId_tenantId: { userId: payload.userId, tenantId: payload.tenantId } },
        data: { role: payload.role },
      })
    } else {
      await this.prisma.membership.create({ data: payload })
    }
    return { ok: true, message: 'Membresía actualizada.' }
  }

  async removeMembership(payload: { userId: string; tenantId: string }) {
    const existing = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: payload.userId, tenantId: payload.tenantId } },
    })
    if (!existing) throw new NotFoundException('Membresía no encontrada.')
    await this.prisma.membership.delete({
      where: { userId_tenantId: { userId: payload.userId, tenantId: payload.tenantId } },
    })
    return { ok: true, message: 'Acceso revocado.' }
  }

  async createInvitation(body: { email: string; role: string; tenantId: string }, actorUserId: string) {
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const token = crypto.randomBytes(32).toString('hex')
    const invitation = await this.prisma.auditEvent.create({
      data: {
        tenantId: body.tenantId,
        entity: 'invitacion',
        action: 'Crear',
        description: `Invitación enviada a ${body.email} con rol ${body.role}. Vence: ${expiresAt.toISOString()}`,
        actor: actorUserId,
        actorUserId,
        severity: 'info',
      },
    })
    return {
      ok: true,
      message: 'Invitación enviada.',
      invitation: {
        id: invitation.id,
        email: body.email,
        role: body.role,
        token,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
      },
    }
  }

  async resendInvitation(id: string) {
    const event = await this.prisma.auditEvent.findUnique({ where: { id } })
    if (!event || event.entity !== 'invitacion') {
      throw new NotFoundException('Invitación no encontrada.')
    }
    return { ok: true, message: 'Invitación reenviada.' }
  }

  async trustSessionFingerprint(sessionId: string, tenantId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, tenantId },
      include: { user: { include: { securityProfile: true } } },
    })
    if (!session) throw new NotFoundException('Sesión no encontrada.')

    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId: session.userId } })
    const fingerprints: string[] = (profile?.trustedFingerprints as string[]) || []
    if (!fingerprints.includes(session.fingerprint)) {
      fingerprints.push(session.fingerprint)
      await this.prisma.userSecurityProfile.update({
        where: { userId: session.userId },
        data: { trustedFingerprints: fingerprints },
      })
    }
    return { ok: true, message: 'Dispositivo marcado como confiable.' }
  }

  async generateRecoveryCodes(userId: string) {
    const codes = Array.from({ length: 8 }, () => this.generateRecoveryCode())
    return { ok: true, message: 'Nuevos códigos generados.', codes }
  }

  async scheduleDeactivation(id: string, at: string, tenantId: string, actorUserId: string) {
    await this.findTenantUser(id, tenantId)
    await this.prisma.user.update({
      where: { id },
      data: { deactivateAt: new Date(at) },
    })
    await this.prisma.auditEvent.create({
      data: {
        tenantId,
        entity: 'usuario',
        action: 'Programar Baja',
        description: `Baja programada para usuario ${id} el ${at}.`,
        actor: actorUserId,
        actorUserId,
        severity: 'info',
      },
    })
    return { ok: true, message: 'Desactivación programada.' }
  }

  async anonymizeUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Usuario no encontrado.')

    const anonymizedEmail = `erased_${crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 16)}@erased.local`

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          name: '[eliminado]',
          email: anonymizedEmail,
          passwordHash: null,
          passwordSalt: null,
          title: '[eliminado]',
          status: 'inactive',
        },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])
    return { ok: true, message: 'Usuario anonimizado correctamente.' }
  }

  private async findTenantUser(id: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, memberships: { some: { tenantId } } },
    })
    if (!user) throw new NotFoundException('Usuario no encontrado en este tenant.')
    return user
  }
}
