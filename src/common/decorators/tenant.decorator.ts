import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { AuthenticatedRequest } from '../../modules/auth/auth.types'

export const TenantId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
  const headerTenantId = request.headers['x-tenant-id'] as string | undefined
  return headerTenantId || request.authUser?.tenantId
})
