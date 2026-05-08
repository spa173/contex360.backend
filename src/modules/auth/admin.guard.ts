import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const user = request.authUser

    if (!user?.isSystemOwner) {
      throw new UnauthorizedException('Acceso denegado. Se requieren permisos de Propietario de Sistema.')
    }

    return true
  }
}
