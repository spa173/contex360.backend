import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthUser } from '../../common/decorators/auth-user.decorator'
import { AuthTokenPayload } from '../auth/auth.types'

@Controller('ai')
@UseGuards(AuthGuard, PermissionsGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(
    @TenantId() tenantId: string, 
    @AuthUser() user: AuthTokenPayload,
    @Body('message') message: string,
    @Body('history') history: any[]
  ) {
    return this.aiService.processChat(tenantId, user.isSystemOwner, message, history)
  }
}
