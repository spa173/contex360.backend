import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Public } from '../auth/public.decorator'
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
    const userName = user.email ? user.email.split('@')[0] : 'Usuario'
    return this.aiService.processChat(tenantId, userName, user.isSystemOwner, message, history)
  }

  @Post('translate')
  translate(
    @Body('texts') texts: Record<string, string>,
    @Body('targetLang') targetLang: string
  ) {
    return this.aiService.translateText(texts, targetLang)
  }

  @Public()
  @Get('health')
  health() {
    return this.aiService.checkHealth()
  }

  @Get('insights')
  getInsights(@TenantId() tenantId: string) {
    return this.aiService.generateDashboardInsights(tenantId)
  }
}
