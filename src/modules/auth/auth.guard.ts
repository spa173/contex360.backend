import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthTokenPayload, AuthenticatedRequest } from './auth.types'

function extractBearerToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header

  if (!value?.startsWith('Bearer ')) {
    return ''
  }

  return value.slice('Bearer '.length).trim()
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = extractBearerToken(request.headers.authorization)

    if (!token) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    try {
      request.authUser = await this.jwtService.verifyAsync<AuthTokenPayload>(token)
      return true
    } catch {
      throw new UnauthorizedException('Token de acceso invalido o expirado.')
    }
  }
}

