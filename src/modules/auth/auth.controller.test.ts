import { UnauthorizedException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { describe, expect, it, vi } from 'vitest'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

describe('AuthController', () => {
  it('delegates login to the auth service with request context', async () => {
    const authService = {
      login: vi.fn(async () => ({ ok: true, message: 'Sesion iniciada.' })),
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

    await expect(
      controller.login(
        { email: 'admin@contex360.local', password: 'secret' },
        {
          headers: {
            'user-agent': 'Mozilla/5.0',
            'x-forwarded-for': '203.0.113.10',
          },
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
      ),
    ).resolves.toEqual({ ok: true, message: 'Sesion iniciada.' })

    expect(authService.login).toHaveBeenCalledWith(
      { email: 'admin@contex360.local', password: 'secret' },
      {
        ip: '203.0.113.10',
        userAgent: 'Mozilla/5.0',
      },
    )
  })

  it('rejects me when the guard did not populate authUser', async () => {
    const authService = {
      me: vi.fn(),
      logout: vi.fn(),
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
    expect(() => controller.logout({ headers: {} } as any)).toThrow(UnauthorizedException)
  })
})
