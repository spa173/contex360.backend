import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../database/prisma.service'
import type { Request } from 'express'

const SKIP_PATHS = ['/2fa', '/auth', '/public', '/api-keys', '/webhooks']

@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { authUser?: any }>()
    const authUser = request.authUser
    if (!authUser || authUser.isSystemOwner) return true

    const url = request.originalUrl || request.url || ''
    if (SKIP_PATHS.some((p) => url.startsWith(p))) return true

    const tenantId = (request.headers as any)['x-tenant-id'] || authUser.tenantId
    if (!tenantId) return true

    const subscription = await this.prisma.subscription.findUnique({ where: { tenantId } })
    if (!subscription || subscription.planType?.toLowerCase() !== 'enterprise') return true

    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId: authUser.sub } })
    if (!profile?.twoFactorRequired) return true
    if (!profile.twoFactorEnabled) {
      throw new ForbiddenException('Debes configurar la autenticación de dos factores (2FA) para acceder con un plan Enterprise.')
    }

    return true
  }
}
