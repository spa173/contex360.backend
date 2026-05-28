import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { ApiKeysService } from './api-keys.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { ApiKeyGuard } from './api-key.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @Post()
  create(@TenantId() tenantId: string, @Body() body: { name: string; expiresInDays?: number }) {
    return this.apiKeysService.createKey(tenantId, body.name, body.expiresInDays)
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @Get()
  list(@TenantId() tenantId: string) {
    return this.apiKeysService.listKeys(tenantId)
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @Delete(':id')
  revoke(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.apiKeysService.revokeKey(tenantId, id)
  }
}

@Controller('public')
export class PublicApiController {
  @UseGuards(ApiKeyGuard)
  @Get('health')
  health() {
    return { status: 'ok', service: 'Contex360 API', version: '1.0' }
  }
}
