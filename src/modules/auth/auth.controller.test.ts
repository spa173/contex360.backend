import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { describe, expect, it, vi } from 'vitest'
import { AuthController } from './auth.controller'
import { AUTH_COOKIE_NAME } from './auth.constants'
import { AuthService } from './auth.service'

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    headers: {
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '203.0.113.10',
      ...overrides.headers,
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }
}

function buildResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
  }
}

describe('AuthController', () => {
  it('delegates login to the auth service and sets the session cookie', async () => {
    const authService = {
      login: vi.fn(async () => ({
        ok: true,
        message: 'Sesion iniciada.',
        accessToken: 'token-123',
      })),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)
    const response = buildResponse()

    await expect(
      controller.login(
        { email: 'admin@contex360.local', password: 'secret' },
        buildRequest(),
        response as any,
      ),
    ).resolves.toEqual({ ok: true, message: 'Sesion iniciada.', accessToken: 'token-123' })

    expect(response.cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      'token-123',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      }),
    )
    expect(authService.login).toHaveBeenCalledWith(
      { email: 'admin@contex360.local', password: 'secret' },
      {
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0',
      },
    )
  })

  it('starts an OAuth flow with the backend service', async () => {
    const authService = {
      buildOAuthAuthorizationUrl: vi.fn(async () => 'https://accounts.google.com/o/oauth2/v2/auth?state=state-123'),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)
    const response = buildResponse()

    await controller.oauthStart('google', 'https://contex360fronted.vercel.app/auth/callback', response as any)

    expect(authService.buildOAuthAuthorizationUrl).toHaveBeenCalledWith(
      'google',
      'https://contex360fronted.vercel.app/auth/callback',
    )
    expect(response.redirect).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?state=state-123',
    )
  })

  it('redirects to the frontend callback when OAuth start fails', async () => {
    const authService = {
      buildOAuthAuthorizationUrl: vi.fn(async () => {
        throw new Error('Faltan credenciales OAuth de Google.')
      }),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)
    const response = buildResponse()

    await controller.oauthStart('google', 'https://contex360fronted.vercel.app/auth/callback', response as any)

    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('auth/callback?error=Faltan%20credenciales%20OAuth%20de%20Google.'),
    )
  })

  it('clears the cookie on logout even when the token is already expired', async () => {
    const authService = {
      verifyAuthToken: vi.fn(async () => ({
        sub: 'user-demo',
        sessionId: 'sess-1',
        tenantId: 'tenant-a',
        email: 'admin@contex360.local',
        isSystemOwner: true,
      })),
      logout: vi.fn(async () => ({ ok: true, message: 'Sesion cerrada.' })),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)
    const response = buildResponse()

    await expect(
      controller.logout(
        {
          headers: {
            authorization: 'Bearer token-123',
          },
        } as any,
        response as any,
      ),
    ).resolves.toEqual({ ok: true, message: 'Sesion cerrada.' })

    expect(authService.verifyAuthToken).toHaveBeenCalledWith('token-123', true)
    expect(authService.logout).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
      }),
    )
    expect(response.clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      }),
    )
  })

  it('rejects me when the guard did not populate authUser', async () => {
    const authService = {
      me: vi.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)

    expect(() => controller.me({ headers: {} } as any)).toThrow(UnauthorizedException)
  })

  it('redirects invalid OAuth providers back to the frontend with an error', async () => {
    const authService = {
      buildOAuthAuthorizationUrl: vi.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
      ],
    }).compile()

    const controller = moduleRef.get(AuthController)
    const response = buildResponse()

    await controller.oauthStart('not-a-provider', undefined, response as any)

    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('auth/callback?error=Proveedor%20OAuth%20invalido.'),
    )
  })
})
