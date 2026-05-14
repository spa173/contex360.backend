import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSIONS_KEY } from './permissions.decorator'
import { ROLE_DEFINITIONS } from './rbac.constants'
import { AuthenticatedRequest } from './auth.types'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const authUser = request.authUser

    if (!authUser) {
      return false
    }

    const headerTenantId = (request.headers as Record<string, string | string[] | undefined>)['x-tenant-id'] as string | undefined
    const activeTenantId = headerTenantId || authUser.tenantId

    // Fetch the membership to get the latest role
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId: authUser.sub,
          tenantId: activeTenantId,
        },
      },
    })

    if (!membership) {
      return false
    }

    const roleDef = ROLE_DEFINITIONS.find((r) => r.id === membership.role)
    if (!roleDef) {
      return false
    }

    // Check if the role has ALL the required permissions
    // (Or ANY, depending on requirements. Usually ALL for security.)
    return requiredPermissions.every((permission) => roleDef.permissions.includes(permission))
  }
}
