import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { AuthenticatedRequest } from '../../modules/auth/auth.types'

export const AuthUser = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
  const user = request.authUser

  return data ? (user as any)?.[data] : user
})
