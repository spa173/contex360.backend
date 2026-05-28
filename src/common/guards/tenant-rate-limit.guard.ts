import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthenticatedRequest } from '../../modules/auth/auth.types'

interface RateLimitEntry {
  count: number
  resetAt: number
}

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private store = new Map<string, RateLimitEntry>()
  private readonly defaultLimit = 100
  private readonly windowMs = 60_000

  constructor(private readonly reflector: Reflector) {
    setInterval(() => this.cleanup(), 60_000)
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authUser = request.authUser
    if (authUser?.isSystemOwner) return true

    const tenantId = (request.headers as any)['x-tenant-id'] || authUser?.tenantId || 'anonymous'
    const now = Date.now()
    const entry = this.store.get(tenantId)

    if (!entry || now > entry.resetAt) {
      this.store.set(tenantId, { count: 1, resetAt: now + this.windowMs })
      return true
    }

    entry.count++
    if (entry.count > this.defaultLimit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      throw new HttpException(
        { message: `Límite de peticiones excedido. Intenta de nuevo en ${retryAfter}s.`, retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    return true
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key)
    }
  }
}
