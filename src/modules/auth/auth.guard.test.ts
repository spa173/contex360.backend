import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { JwtService } from '@nestjs/jwt'
import { AuthGuard } from './auth.guard'

function buildContext(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          authorization,
        },
      }),
    }),
  }
}

describe('AuthGuard', () => {
  it('extracts and verifies the bearer token', async () => {
    const jwtService = {
      verifyAsync: vi.fn(async () => ({
        sub: 'user-demo',
        sessionId: 'sess-1',
        tenantId: 'tenant-a',
        email: 'admin@contex360.local',
      })),
    } as unknown as JwtService

    const guard = new AuthGuard(jwtService)
    const context = buildContext('Bearer token-123') as any

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-123')
  })

  it('rejects requests without a bearer token', async () => {
    const jwtService = {
      verifyAsync: vi.fn(),
    } as unknown as JwtService

    const guard = new AuthGuard(jwtService)

    await expect(guard.canActivate(buildContext() as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})
