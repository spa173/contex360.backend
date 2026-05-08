import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PermissionsGuard } from './permissions.guard'

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard
  let reflector: any
  let prisma: any

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn(),
    }
    prisma = {
      membership: {
        findUnique: vi.fn(),
      },
    }
    guard = new PermissionsGuard(reflector, prisma)
  })

  it('allows access if no permissions required', async () => {
    reflector.getAllAndOverride.mockReturnValue([])
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(true)
  })

  it('denies access if no authUser in request', async () => {
    reflector.getAllAndOverride.mockReturnValue(['view_dashboard'])
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ authUser: null }),
      }),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(false)
  })

  it('denies access if membership not found', async () => {
    reflector.getAllAndOverride.mockReturnValue(['view_dashboard'])
    prisma.membership.findUnique.mockResolvedValue(null)
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ authUser: { sub: 'u1', tenantId: 't1' } }),
      }),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(false)
  })

  it('denies access if role not found in definitions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['view_dashboard'])
    prisma.membership.findUnique.mockResolvedValue({ role: 'NonExistent' })
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ authUser: { sub: 'u1', tenantId: 't1' } }),
      }),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(false)
  })

  it('allows access if role has required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['emit_invoice'])
    prisma.membership.findUnique.mockResolvedValue({ role: 'Administrador' }) // Admin has emit_invoice
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ authUser: { sub: 'u1', tenantId: 't1' } }),
      }),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(true)
  })

  it('denies access if role lacks required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['manage_users'])
    prisma.membership.findUnique.mockResolvedValue({ role: 'Visor' }) // Visor does not have manage_users
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ authUser: { sub: 'u1', tenantId: 't1' } }),
      }),
    } as any

    const result = await guard.canActivate(context)
    expect(result).toBe(false)
  })
})
