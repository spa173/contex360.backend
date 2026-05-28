import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiKeysService } from './api-keys.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const apiKey = (request.headers as any)['x-api-key'] as string | undefined

    if (!apiKey) {
      throw new UnauthorizedException('API key requerida. Incluye el header X-API-Key.')
    }

    const keyRecord = await this.apiKeysService.validateKey(apiKey)
    if (!keyRecord || !keyRecord.active) {
      throw new UnauthorizedException('API key inválida o inactiva.')
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('API key expirada.')
    }

    request.authUser = { ...request.authUser, tenantId: keyRecord.tenantId }

    this.apiKeysService.touchLastUsed(apiKey)

    return true
  }
}
