import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { UnauthorizedException } from '@nestjs/common'
import { AuthGuard } from './auth.guard'
import { IS_PUBLIC_KEY } from './public.decorator'

function mockContext(overrides?: {
  authorization?: string
  cookie?: string
  'x-tenant-id'?: string
  isPublic?: boolean
}): any {
  const headers: Record<string, string> = {}
  if (overrides?.authorization !== undefined) headers.authorization = overrides.authorization
  if (overrides?.cookie !== undefined) headers.cookie = overrides.cookie
  if (overrides?.['x-tenant-id'] !== undefined) headers['x-tenant-id'] = overrides['x-tenant-id']

  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, authUser: undefined }),
    }),
    getHandler: () => null,
    getClass: () => null,
  }
}

describe('AuthGuard', () => {
  let guard: AuthGuard
  let jwtService: JwtService
  let reflector: Reflector

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: vi.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: vi.fn(),
          },
        },
      ],
    }).compile()

    guard = module.get<AuthGuard>(AuthGuard)
    jwtService = module.get<JwtService>(JwtService)
    reflector = module.get<Reflector>(Reflector)
  })

  describe('sin token', () => {
    it('debe rechazar peticion sin Authorization ni Cookie', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      const ctx = mockContext()

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
      await expect(guard.canActivate(ctx)).rejects.toThrow('Token de acceso requerido.')
    })

    it('debe rechazar peticion con Authorization vacio', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      const ctx = mockContext({ authorization: '' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    })

    it('debe rechazar peticion con Cookie vacia', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      const ctx = mockContext({ cookie: '' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('token invalido / expirado / falso', () => {
    it('debe rechazar token con formato incorrecto (no Bearer)', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      const ctx = mockContext({ authorization: 'InvalidToken' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    })

    it('debe rechazar token expirado', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('TokenExpiredError: jwt expired'))
      const ctx = mockContext({ authorization: 'Bearer eyJ.expired.token' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
      await expect(guard.canActivate(ctx)).rejects.toThrow('Token de acceso invalido o expirado.')
    })

    it('debe rechazar token falsificado (firma invalida)', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('JsonWebTokenError: invalid signature'))
      const ctx = mockContext({ authorization: 'Bearer eyJ.eyJ.fake' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    })

    it('debe rechazar token con payload malformado', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockRejectedValue(new Error('jwt malformed'))
      const ctx = mockContext({ authorization: 'Bearer not-a-token' })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('token valido', () => {
    const validPayload = {
      sub: 'user-123',
      sessionId: 'session-456',
      tenantId: 'tenant-789',
      email: 'user@test.com',
      isSystemOwner: false,
      tenantIds: ['tenant-789'],
    }

    it('debe aceptar token Bearer valido', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue(validPayload)
      const ctx = mockContext({ authorization: 'Bearer valid.jwt.token' })

      await expect(guard.canActivate(ctx)).resolves.toBe(true)
    })

    it('debe aceptar token via Cookie', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue(validPayload)
      const ctx = mockContext({ cookie: 'contex360-auth-token=valid.jwt.token; other=stuff' })

      await expect(guard.canActivate(ctx)).resolves.toBe(true)
    })
  })

  describe('validacion de x-tenant-id', () => {
    const payload = {
      sub: 'user-123',
      sessionId: 'session-456',
      tenantId: 'tenant-789',
      email: 'user@test.com',
      isSystemOwner: false,
      tenantIds: ['tenant-789'],
    }

    it('debe aceptar si x-tenant-id coincide con los tenants del usuario', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload)
      const ctx = mockContext({
        authorization: 'Bearer valid.jwt.token',
        'x-tenant-id': 'tenant-789',
      })

      await expect(guard.canActivate(ctx)).resolves.toBe(true)
    })

    it('debe rechazar si x-tenant-id no pertenece al usuario', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue(payload)
      const ctx = mockContext({
        authorization: 'Bearer valid.jwt.token',
        'x-tenant-id': 'other-tenant',
      })

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
      await expect(guard.canActivate(ctx)).rejects.toThrow('No tienes acceso a esta empresa.')
    })

    it('debe aceptar cualquier tenant si el usuario es systemOwner', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false)
      const ownerPayload = { ...payload, isSystemOwner: true, tenantIds: ['tenant-789'] }
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue(ownerPayload)
      const ctx = mockContext({
        authorization: 'Bearer owner.jwt.token',
        'x-tenant-id': 'any-tenant',
      })

      await expect(guard.canActivate(ctx)).resolves.toBe(true)
    })
  })

  describe('rutas publicas', () => {
    it('debe permitir el paso sin token si la ruta tiene @Public', async () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true)
      const ctx = mockContext()

      await expect(guard.canActivate(ctx)).resolves.toBe(true)
    })
  })
})
