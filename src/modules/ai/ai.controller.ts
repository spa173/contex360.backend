import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('ai')
@UseGuards(PermissionsGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(@TenantId() tenantId: string, @Body('message') message: string) {
    return this.aiService.processChat(tenantId, message)
  }
}
