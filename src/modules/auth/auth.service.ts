import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma, User, UserSession, UserStatus } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  AuthRequestContext,
  AuthResponseSnapshot,
  AuthTokenPayload,
  OAuthLoginResult,
  OAuthStatePayload,
  LoginRequestDto,
  PublicSessionSnapshot,
  PublicTenantSnapshot,
  PublicUserSnapshot,
  RefreshTokenDto,
  TotpRequiredResponse,
  PasswordExpiredResponse,
  ChangePasswordDto,
  UpdateProfileDto,
} from './auth.types'
import { ROLE_DEFINITIONS } from './rbac.constants'
import { TotpService } from './totp.service'
import { PrismaService } from '../database/prisma.service'
import { OAuthProvider } from './auth.constants'
import {
  buildOAuthAuthorizationUrl,
  exchangeOAuthCodeForToken,
  fetchOAuthProfile,
  getDefaultFrontendCallbackUrl,
  resolveAllowedRedirectTo,
  OAuthProfileSnapshot,
} from './oauth.providers'

type UserWithAuthRelations = Prisma.UserGetPayload<{
  include: {
    memberships: {
      include: {
        tenant: true
      }
    }
    securityProfile: true
  }
}>

interface PasswordPolicySnapshot {
  failedAttemptsThreshold: number
  lockoutMinutes: number
}

const DEFAULT_PASSWORD_POLICY: PasswordPolicySnapshot = {
  failedAttemptsThreshold: 5,
  lockoutMinutes: 30,
}

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase()
}

function normalizeUserAgent(userAgent: string) {
  return String(userAgent || '').trim()
}

function toIso(value: Date | string | null | undefined) {
  if (!value) {
    return null
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function createFingerprint(userId: string, context: AuthRequestContext) {
  return createHash('sha256').update(`${userId}:${context.ip}:${context.userAgent}`).digest('hex')
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly totpService: TotpService,
  ) {}

  async login(credentials: LoginRequestDto, context: AuthRequestContext): Promise<AuthResponseSnapshot | TotpRequiredResponse | PasswordExpiredResponse> {
    const email = normalizeEmail(credentials.email)
    const password = String(credentials.password || '')

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          orderBy: { createdAt: 'asc' },
          include: { tenant: true },
        },
        securityProfile: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('Credenciales invalidas. Revisa el email y la clave.')
    }

    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('Este usuario aun no esta habilitado por un administrador.')
    }

    const passwordPolicy = this.getPasswordPolicy(user)
    this.ensureLoginAllowed(user)

    const passwordMatches = user.passwordHash ? await compare(password, user.passwordHash) : false
    if (!passwordMatches) {
      await this.markFailedLogin(user, passwordPolicy)
      throw new UnauthorizedException('Credenciales invalidas. Revisa el email y la clave.')
    }

    if (!user.memberships.length && !user.isSystemOwner) {
      throw new ForbiddenException('El usuario no tiene empresas asignadas.')
    }

    if (user.securityProfile?.twoFactorEnabled) {
      if (!credentials.totpCode) {
        return { ok: false, requiresTotp: true, message: 'Se requiere el codigo de autenticacion de dos factores.' }
      }
      const isValid = await this.totpService.verifyTotp(user.id, credentials.totpCode)
      if (!isValid) {
        throw new UnauthorizedException('Codigo 2FA invalido. Intenta de nuevo.')
      }
    }

    const passwordExpired = this.isPasswordExpired(user.securityProfile)
    if (passwordExpired) {
      return { ok: false, requiresPasswordChange: true, message: 'Tu contrasena ha expirado. Debes establecer una nueva para continuar.' }
    }

    return this.issueAuthResponse(user, context)
  }

  async buildOAuthAuthorizationUrl(provider: OAuthProvider, redirectTo?: string) {
    const state = await this.createOAuthState(provider, resolveAllowedRedirectTo(redirectTo))
    return buildOAuthAuthorizationUrl(provider, state)
  }

  async completeOAuthLogin(
    provider: OAuthProvider,
    code: string,
    state: string,
    context: AuthRequestContext,
  ): Promise<OAuthLoginResult> {
    if (!code) {
      throw new UnauthorizedException('No se recibio el codigo OAuth.')
    }

    const statePayload = await this.verifyOAuthState(state, provider)
    const tokenSet = await exchangeOAuthCodeForToken(provider, code)
    const accessToken = tokenSet.access_token
    if (!accessToken) {
      throw new UnauthorizedException('No se recibio el access token OAuth.')
    }

    const profile = await fetchOAuthProfile(provider, accessToken)
    const user = await this.resolveOAuthUser(profile)
    const auth = await this.issueAuthResponse(user, context)

    return {
      auth,
      redirectTo: statePayload.redirectTo || getDefaultFrontendCallbackUrl(),
      provider,
      profile: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      },
    }
  }

  async refresh(dto: RefreshTokenDto, context: AuthRequestContext): Promise<AuthResponseSnapshot> {
    const tokenHash = createHash('sha256').update(dto.refreshToken).digest('hex')

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            memberships: { orderBy: { createdAt: 'asc' }, include: { tenant: true } },
            securityProfile: true,
          },
        },
      },
    })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalido o expirado.')
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    })

    return this.issueAuthResponse(stored.user, context)
  }

  async verifyAuthToken(token: string, ignoreExpiration = false) {
    if (!token) {
      return null
    }

    try {
      return await this.jwtService.verifyAsync<AuthTokenPayload>(token, {
        ignoreExpiration,
      })
    } catch {
      return null
    }
  }

  async me(authUser: AuthTokenPayload): Promise<Omit<AuthResponseSnapshot, 'accessToken' | 'refreshToken'>> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.sub },
      include: {
        memberships: {
          orderBy: { createdAt: 'asc' },
          include: { tenant: true },
        },
        securityProfile: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('Token de acceso invalido o expirado.')
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: authUser.sessionId },
    })

    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Token de acceso invalido o expirado.')
    }

    const activeTenant = await this.resolveActiveTenant(user, authUser.tenantId)
    const now = new Date()

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    })

    return {
      ok: true,
      message: 'Sesion activa.',
      user: this.mapUserSnapshot(user),
      session: this.mapSessionSnapshot({ ...session, lastSeenAt: now }),
      activeTenantId: activeTenant.id,
      accessibleTenants: user.isSystemOwner 
        ? (await this.prisma.tenant.findMany()).map(t => this.mapTenantSnapshot(t))
        : user.memberships.map((membership) => this.mapTenantSnapshot(membership.tenant)),
      memberships: user.memberships.map((membership) => {
        const roleDef = ROLE_DEFINITIONS.find((r) => r.id === membership.role)
        return {
          userId: user.id,
          tenantId: membership.tenantId,
          role: membership.role,
          permissions: roleDef?.permissions || [],
          accessibleViews: roleDef?.views || [],
          access: roleDef?.access || {},
        }
      }),
    }
  }

  async logout(authUser: AuthTokenPayload) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: authUser.sessionId },
    })

    if (session && !session.revokedAt) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedBy: 'Usuario autenticado',
        },
      })
    }

    return {
      ok: true,
      message: 'Sesion cerrada.',
    }
  }

  private async issueAuthResponse(user: UserWithAuthRelations, context: AuthRequestContext): Promise<AuthResponseSnapshot> {
    if (user.status !== UserStatus.active) {
      throw new ForbiddenException('Este usuario aun no esta habilitado por un administrador.')
    }

    if (!user.memberships.length && !user.isSystemOwner) {
      throw new ForbiddenException('El usuario no tiene empresas asignadas.')
    }

    const now = new Date()
    const activeTenantIdFromMembership = user.memberships[0]?.tenant.id
    const activeTenantId = activeTenantIdFromMembership || 'system'
    const activeTenant = await this.resolveActiveTenant(user, activeTenantId)
    const session = await this.createSession(user, activeTenant?.id || 'system', context, now)

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    })

    await this.prisma.userSecurityProfile.upsert({
      where: { userId: user.id },
      update: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordUpdatedAt: user.securityProfile?.passwordUpdatedAt || now,
      },
      create: this.buildDefaultSecurityProfile(user.id, now),
    })

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      sessionId: session.id,
      tenantId: activeTenant?.id || 'system',
      email: user.email,
      isSystemOwner: user.isSystemOwner,
      tenantIds: user.memberships.map(m => m.tenantId),
    })

    const rawRefreshToken = randomBytes(48).toString('hex')
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await this.prisma.refreshToken.create({
      data: { tokenHash, userId: user.id, sessionId: session.id, expiresAt },
    })

    return {
      ok: true,
      message: 'Sesion iniciada.',
      accessToken,
      refreshToken: rawRefreshToken,
      user: this.mapUserSnapshot({ ...user, lastLoginAt: now }),
      session: this.mapSessionSnapshot(session),
      activeTenantId: activeTenant?.id || 'system',
      accessibleTenants: user.isSystemOwner
        ? (await this.prisma.tenant.findMany()).map(t => this.mapTenantSnapshot(t))
        : user.memberships.map((membership) => this.mapTenantSnapshot(membership.tenant)),
      memberships: user.memberships.map((membership) => {
        const roleDef = ROLE_DEFINITIONS.find((r) => r.id === membership.role)
        return {
          userId: user.id,
          tenantId: membership.tenantId,
          role: membership.role,
          permissions: roleDef?.permissions || [],
          accessibleViews: roleDef?.views || [],
          access: roleDef?.access || {},
        }
      }),
    }
  }

  private async createOAuthState(provider: OAuthProvider, redirectTo: string) {
    return this.jwtService.signAsync(
      {
        provider,
        redirectTo,
        nonce: randomUUID(),
      } satisfies OAuthStatePayload,
      {
        secret: this.getOAuthStateSecret(),
        expiresIn: '10m',
      },
    )
  }

  private async verifyOAuthState(state: string, provider: OAuthProvider) {
    if (!state) {
      throw new UnauthorizedException('No se recibio el estado OAuth.')
    }

    const payload = await this.jwtService.verifyAsync<OAuthStatePayload>(state, {
      secret: this.getOAuthStateSecret(),
    })

    if (payload.provider !== provider) {
      throw new UnauthorizedException('Estado OAuth invalido.')
    }

    return {
      ...payload,
      redirectTo: resolveAllowedRedirectTo(payload.redirectTo),
    }
  }

  private getOAuthStateSecret() {
    return process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || 'change-me-in-development'
  }

  private async resolveOAuthUser(profile: OAuthProfileSnapshot) {
    const user = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: {
        memberships: {
          orderBy: { createdAt: 'asc' },
          include: { tenant: true },
        },
        securityProfile: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException(
        `No existe una cuenta corporativa asociada a ${profile.email}. Solicita acceso al administrador.`,
      )
    }

    return user
  }

  private ensureLoginAllowed(user: UserWithAuthRelations) {
    const lockedUntil = user.securityProfile?.lockedUntil
    if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
      throw new ForbiddenException(`Cuenta bloqueada temporalmente hasta ${new Date(lockedUntil).toISOString()}.`)
    }
  }

  private getPasswordPolicy(user: UserWithAuthRelations): PasswordPolicySnapshot {
    const tenant = user.memberships[0]?.tenant
    const settings = (tenant?.securitySettings || {}) as {
      passwordPolicy?: Partial<PasswordPolicySnapshot>
    }

    return {
      ...DEFAULT_PASSWORD_POLICY,
      ...settings.passwordPolicy,
    }
  }

  private async resolveActiveTenant(user: UserWithAuthRelations, tenantId?: string) {
    const memberships = user.memberships
    const tenantFromToken = tenantId ? (memberships.find((membership) => membership.tenantId === tenantId)?.tenant || (user.isSystemOwner ? await this.prisma.tenant.findUnique({ where: { id: tenantId } }) : null)) : null

    return tenantFromToken || memberships[0]?.tenant || null
  }

  private async createSession(
    user: UserWithAuthRelations,
    tenantId: string,
    context: AuthRequestContext,
    now: Date,
  ): Promise<UserSession> {
    return this.prisma.userSession.create({
      data: {
        userId: user.id,
        tenantId,
        ip: context.ip || '127.0.0.1',
        location: 'Local',
        device: normalizeUserAgent(context.userAgent) || 'Navegador web',
        browser: this.classifyBrowser(context.userAgent),
        os: this.classifyOperatingSystem(context.userAgent),
        fingerprint: createFingerprint(user.id, context),
        createdAt: now,
        lastSeenAt: now,
      },
    })
  }

  private async markFailedLogin(user: UserWithAuthRelations, policy: PasswordPolicySnapshot) {
    const nextAttempts = (user.securityProfile?.failedLoginAttempts || 0) + 1
    const lockedUntil =
      nextAttempts >= policy.failedAttemptsThreshold
        ? new Date(Date.now() + policy.lockoutMinutes * 60 * 1000)
        : null

    await this.prisma.userSecurityProfile.upsert({
      where: { userId: user.id },
      update: {
        failedLoginAttempts: nextAttempts,
        lockedUntil,
      },
      create: {
        ...this.buildDefaultSecurityProfile(user.id, new Date()),
        failedLoginAttempts: nextAttempts,
        lockedUntil,
      },
    })
  }

  private buildDefaultSecurityProfile(userId: string, now: Date) {
    return {
      userId,
      twoFactorEnabled: false,
      twoFactorRequired: false,
      passwordResetRequired: false,
      passwordUpdatedAt: now,
      resetRequestedAt: null,
      tempPasswordExpiresAt: null,
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    }
  }

  private classifyBrowser(userAgent: string) {
    const normalized = normalizeUserAgent(userAgent).toLowerCase()

    if (normalized.includes('edg/')) return 'Edge'
    if (normalized.includes('chrome/')) return 'Chrome'
    if (normalized.includes('firefox/')) return 'Firefox'
    if (normalized.includes('safari/')) return 'Safari'
    return 'Browser'
  }

  private classifyOperatingSystem(userAgent: string) {
    const normalized = normalizeUserAgent(userAgent).toLowerCase()

    if (normalized.includes('windows')) return 'Windows'
    if (normalized.includes('mac os') || normalized.includes('macintosh')) return 'macOS'
    if (normalized.includes('android')) return 'Android'
    if (normalized.includes('iphone') || normalized.includes('ipad') || normalized.includes('ios')) return 'iOS'
    if (normalized.includes('linux')) return 'Linux'
    return 'OS'
  }

  private mapUserSnapshot(user: User & { securityProfile?: any }): PublicUserSnapshot {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      title: user.title,
      status: user.status,
      lastLoginAt: toIso(user.lastLoginAt),
      isSystemOwner: user.isSystemOwner,
      isDemoAccount: user.isDemoAccount,
      twoFactorEnabled: user.securityProfile?.twoFactorEnabled ?? false,
    }
  }

  private mapTenantSnapshot(tenant: any): PublicTenantSnapshot {
    return {
      id: tenant.id,
      name: tenant.name,
      prefix: tenant.prefix,
      sector: tenant.sector || null,
      city: tenant.city || null,
      allowNegativeStock: tenant.allowNegativeStock,
      costMethod: tenant.costMethod || null,
      dianStatus: tenant.dianStatus || null,
    }
  }

  private isPasswordExpired(securityProfile: { passwordExpiryDays?: number | null; passwordUpdatedAt?: Date | null } | null | undefined): boolean {
    if (!securityProfile) return false
    const expiryDays = securityProfile.passwordExpiryDays ?? 90
    if (expiryDays <= 0) return false
    const updatedAt = securityProfile.passwordUpdatedAt
    if (!updatedAt) return false
    const expiresAt = new Date(new Date(updatedAt).getTime() + expiryDays * 24 * 60 * 60 * 1000)
    return new Date() > expiresAt
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ ok: boolean; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { securityProfile: true },
    })
    if (!user) throw new UnauthorizedException('Usuario no encontrado.')

    const matches = user.passwordHash ? await compare(dto.currentPassword, user.passwordHash) : false
    if (!matches) throw new UnauthorizedException('La contrasena actual es incorrecta.')

    const newHash = await hash(dto.newPassword, 12)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      this.prisma.userSecurityProfile.upsert({
        where: { userId },
        create: {
          userId,
          passwordUpdatedAt: new Date(),
          passwordHistory: [],
          trustedFingerprints: [],
        },
        update: { passwordUpdatedAt: new Date() },
      }),
    ])

    return { ok: true, message: 'Contrasena actualizada correctamente.' }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUserSnapshot> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        title: dto.title,
      },
      include: { securityProfile: true },
    })
    return this.mapUserSnapshot(user)
  }

  private mapSessionSnapshot(session: UserSession): PublicSessionSnapshot {
    return {
      id: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      ip: session.ip,
      location: session.location,
      device: session.device,
      browser: session.browser,
      os: session.os,
      fingerprint: session.fingerprint,
      createdAt: toIso(session.createdAt) || new Date().toISOString(),
      lastSeenAt: toIso(session.lastSeenAt) || new Date().toISOString(),
      revokedAt: toIso(session.revokedAt),
      revokedBy: session.revokedBy || null,
    }
  }
}
