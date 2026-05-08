import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AdminGuard } from './admin.guard'

describe('AdminGuard', () => {
  const mockReflector = {} as any

  it('allows access for system owners', () => {
    const guard = new AdminGuard(mockReflector)
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          authUser: { isSystemOwner: true },
        }),
      }),
    } as any

    expect(guard.canActivate(context)).toBe(true)
  })

  it('throws UnauthorizedException for non-system owners', () => {
    const guard = new AdminGuard(mockReflector)
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          authUser: { isSystemOwner: false },
        }),
      }),
    } as any

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException for missing authUser', () => {
    const guard = new AdminGuard(mockReflector)
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as any

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })
})
