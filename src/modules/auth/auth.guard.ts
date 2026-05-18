import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AUTH_COOKIE_NAME } from './auth.constants'
import { AuthTokenPayload, AuthenticatedRequest } from './auth.types'
import { IS_PUBLIC_KEY } from './public.decorator'

function extractBearerToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header

  if (!value?.startsWith('Bearer ')) {
    return ''
  }

  return value.slice('Bearer '.length).trim()
}

function extractCookieToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header

  if (!value) {
    return ''
  }

  return value
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`))
    ?.slice(`${AUTH_COOKIE_NAME}=`.length)
    .trim() || ''
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const cookieToken = extractCookieToken(request.headers.cookie)
    const bearerToken = extractBearerToken(request.headers.authorization)
    const tokens = [cookieToken, bearerToken].filter(Boolean)

    if (!tokens.length) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    for (const token of tokens) {
      try {
        const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token)
        
        // Tenant validation
        const headerTenantId = (request.headers as any)['x-tenant-id']
        if (headerTenantId) {
          if (!payload.isSystemOwner && !payload.tenantIds.includes(headerTenantId)) {
            throw new UnauthorizedException('No tienes acceso a esta empresa.')
          }
        }

        request.authUser = payload
        return true
      } catch (error: any) {
        if (error instanceof UnauthorizedException) throw error
        continue
      }
    }

    throw new UnauthorizedException('Token de acceso invalido o expirado.')
  }
}

