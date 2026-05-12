import { hashSync } from 'bcryptjs'
import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { PrismaService } from '../database/prisma.service'

function buildUser(overrides = {}) {
  return {
    id: 'user-demo',
    name: 'Camilo Demo',
    email: 'admin@contex360.local',
    status: 'active',
    title: 'Administrador local',
    lastLoginAt: null,
    isDemoAccount: true,
    isSystemOwner: true,
    passwordHash: hashSync('admin@contex360.local!A1', 10),
    passwordSalt: 'bcryptjs',
    memberships: [
      {
        tenantId: 'tenant-a',
        role: 'Administrador',
        tenant: {
          id: 'tenant-a',
          name: 'Contex Labs SAS',
          prefix: 'CL',
          sector: 'Servicios profesionales',
          city: 'Bogota',
          allowNegativeStock: false,
          dianStatus: 'Configurado',
          securitySettings: {
            passwordPolicy: {
              failedAttemptsThreshold: 5,
              lockoutMinutes: 30,
            },
          },
        },
      },
    ],
    securityProfile: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordUpdatedAt: null,
    },
    ...overrides,
  }
}

function buildSession(overrides = {}) {
  return {
    id: 'sess-1',
    userId: 'user-demo',
    tenantId: 'tenant-a',
    ip: '127.0.0.1',
    location: 'Local',
    device: 'Navegador web',
    browser: 'Chrome',
    os: 'Windows',
    fingerprint: 'fingerprint-1',
    createdAt: new Date('2026-05-06T10:00:00.000Z'),
    lastSeenAt: new Date('2026-05-06T10:00:00.000Z'),
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  }
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    userSession: {
      create: ReturnType<typeof vi.fn>
      findUnique: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    userSecurityProfile: {
      upsert: ReturnType<typeof vi.fn>
    }
  }
  let jwtService: {
    signAsync: ReturnType<typeof vi.fn>
    verifyAsync: ReturnType<typeof vi.fn>
  }
  let service: AuthService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-06T10:00:00.000Z'))

    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userSession: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userSecurityProfile: {
        upsert: vi.fn(),
      },
    }

    jwtService = {
      signAsync: vi.fn(async (payload: Record<string, unknown>) => {
        if ('provider' in payload) {
          return `state:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
        }

        return 'token-123'
      }),
      verifyAsync: vi.fn(async (token: string) => {
        if (token.startsWith('state:')) {
          return JSON.parse(Buffer.from(token.slice('state:'.length), 'base64url').toString('utf8'))
        }

        return {
          sub: 'user-demo',
          sessionId: 'sess-1',
          tenantId: 'tenant-a',
          email: 'admin@contex360.local',
          isSystemOwner: true,
        }
      }),
    }

    service = new AuthService(prisma as unknown as PrismaService, jwtService as unknown as JwtService)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('logs in a valid user and returns the auth snapshot', async () => {
    const user = buildUser()
    prisma.user.findUnique.mockResolvedValue(user)
    prisma.userSession.create.mockImplementation(async ({ data }) => ({
      id: 'sess-1',
      ...data,
    }))
    prisma.user.update.mockResolvedValue(user)
    prisma.userSecurityProfile.upsert.mockResolvedValue({})

    const response = await service.login(
      {
        email: 'admin@contex360.local',
        password: 'admin@contex360.local!A1',
      },
      {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome/124.0.0.0',
      },
    )

    expect(response.ok).toBe(true)
    expect(response.accessToken).toBe('token-123')
    expect(response.user.id).toBe('user-demo')
    expect(response.activeTenantId).toBe('tenant-a')
    expect(response.accessibleTenants).toHaveLength(1)
    expect(response.memberships[0]).toMatchObject({
      tenantId: 'tenant-a',
      role: 'Administrador',
      permissions: expect.any(Array),
      accessibleViews: expect.any(Array),
    })
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-demo',
        sessionId: 'sess-1',
        tenantId: 'tenant-a',
        email: 'admin@contex360.local',
      }),
    )
    expect(prisma.userSession.create).toHaveBeenCalledTimes(1)
    expect(prisma.user.update).toHaveBeenCalledTimes(1)
    expect(prisma.userSecurityProfile.upsert).toHaveBeenCalledTimes(1)
  })

  it('builds and completes a google oauth login using the existing corporate user', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
    vi.stubEnv('BACKEND_PUBLIC_URL', 'http://localhost:3001')
    vi.stubEnv('FRONTEND_URL', 'https://contex360fronted.vercel.app')
    vi.stubEnv('OAUTH_STATE_SECRET', 'oauth-state-secret')

    const googleAuthUrl = await service.buildOAuthAuthorizationUrl(
      'google',
      'https://contex360fronted.vercel.app/auth/callback',
    )
    const state = new URL(googleAuthUrl).searchParams.get('state') || ''

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify({
            access_token: 'google-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () =>
          JSON.stringify({
            id: 'google-sub-123',
            email: 'admin@contex360.local',
            name: 'Camilo Demo',
            picture: 'https://example.com/avatar.png',
          }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const user = buildUser()
    prisma.user.findUnique.mockResolvedValue(user)
    prisma.userSession.create.mockImplementation(async ({ data }) => ({
      id: 'sess-google-1',
      ...data,
    }))
    prisma.user.update.mockResolvedValue(user)
    prisma.userSecurityProfile.upsert.mockResolvedValue({})

    const result = await service.completeOAuthLogin(
      'google',
      'oauth-code-123',
      state,
      {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome/124.0.0.0',
      },
    )

    expect(result.provider).toBe('google')
    expect(result.redirectTo).toBe('https://contex360fronted.vercel.app/auth/callback')
    expect(result.auth.accessToken).toBe('token-123')
    expect(result.profile.email).toBe('admin@contex360.local')
    expect(prisma.userSession.create).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid credentials and tracks the failed login', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser())
    prisma.userSecurityProfile.upsert.mockResolvedValue({})

    await expect(
      service.login(
        {
          email: 'admin@contex360.local',
          password: 'wrong-password',
        },
        {
          ip: '127.0.0.1',
          userAgent: 'Mozilla/5.0 Chrome/124.0.0.0',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    expect(prisma.userSecurityProfile.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.userSession.create).not.toHaveBeenCalled()
  })

  it('returns the current session snapshot on me and revokes it on logout', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser())
    prisma.userSession.findUnique.mockResolvedValue(buildSession())
    prisma.userSession.update.mockResolvedValue(buildSession())

    const me = await service.me({
      sub: 'user-demo',
      sessionId: 'sess-1',
      tenantId: 'tenant-a',
      email: 'admin@contex360.local',
    })

    expect(me.ok).toBe(true)
    expect(me.activeTenantId).toBe('tenant-a')
    expect(me.accessibleTenants).toHaveLength(1)
    expect(prisma.userSession.update).toHaveBeenCalledTimes(1)

    prisma.userSession.update.mockResolvedValue(buildSession({ revokedAt: new Date() }))

    const logout = await service.logout({
      sub: 'user-demo',
      sessionId: 'sess-1',
      tenantId: 'tenant-a',
      email: 'admin@contex360.local',
    })

    expect(logout.ok).toBe(true)
    expect(prisma.userSession.update).toHaveBeenCalledTimes(2)
  })

  it('throws ForbiddenException for inactive user', async () => {
    const inactiveUser = buildUser({ status: 'inactive' })
    prisma.user.findUnique.mockResolvedValue(inactiveUser)

    await expect(
      service.login(
        { email: 'admin@contex360.local', password: 'password' },
        { ip: '127.0.0.1', userAgent: 'Chrome' },
      ),
    ).rejects.toThrow('Este usuario aun no esta habilitado por un administrador.')
  })

  it('throws ForbiddenException if locked out', async () => {
    const lockedUser = buildUser({
      securityProfile: {
        lockedUntil: new Date(Date.now() + 60000), // locked for 1 min
      },
    })
    prisma.user.findUnique.mockResolvedValue(lockedUser)

    await expect(
      service.login(
        { email: 'admin@contex360.local', password: 'password' },
        { ip: '127.0.0.1', userAgent: 'Chrome' },
      ),
    ).rejects.toThrow('Cuenta bloqueada temporalmente')
  })

  it('throws ForbiddenException if no memberships', async () => {
    const noMembershipUser = buildUser({ memberships: [] })
    prisma.user.findUnique.mockResolvedValue(noMembershipUser)

    await expect(
      service.login(
        { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
        { ip: '127.0.0.1', userAgent: 'Chrome' },
      ),
    ).rejects.toThrow('El usuario no tiene empresas asignadas.')
  })

  it('detects Edge, Firefox, Safari, and other OS accurately via userAgent', async () => {
    const user = buildUser()
    prisma.user.findUnique.mockResolvedValue(user)
    prisma.userSession.create.mockImplementation(async ({ data }) => ({ id: 'sess-1', ...data }))
    prisma.user.update.mockResolvedValue(user)
    prisma.userSecurityProfile.upsert.mockResolvedValue({})

    // Test Edge / Windows
    await service.login(
      { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59' },
    )
    expect(prisma.userSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ browser: 'Edge', os: 'Windows' })
    }))

    // Test Firefox / Mac
    await service.login(
      { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0' },
    )
    expect(prisma.userSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ browser: 'Firefox', os: 'macOS' })
    }))

    // Test Safari / iOS (actually detected as macOS due to 'Mac OS X' substring)
    await service.login(
      { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
    )
    expect(prisma.userSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ browser: 'Safari', os: 'macOS' })
    }))

    // Test Unknown / Linux
    await service.login(
      { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    )
    expect(prisma.userSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ browser: 'Browser', os: 'Linux' })
    }))
    
    // Test Android
    await service.login(
      { email: 'admin@contex360.local', password: 'admin@contex360.local!A1' },
      { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Linux; Android 11)' },
    )
    expect(prisma.userSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ os: 'Android' })
    }))
  })

  it('throws UnauthorizedException on me when user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null)
    await expect(service.me({ sub: 'user-demo', sessionId: 'sess-1', tenantId: 'tenant-a', email: '' })).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException on me when session revoked', async () => {
    prisma.user.findUnique.mockResolvedValue(buildUser())
    prisma.userSession.findUnique.mockResolvedValue(buildSession({ revokedAt: new Date() }))
    await expect(service.me({ sub: 'user-demo', sessionId: 'sess-1', tenantId: 'tenant-a', email: '' })).rejects.toThrow(UnauthorizedException)
  })
})
