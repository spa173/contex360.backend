import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { WebhookService } from './webhook.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('webhooks')
@UseGuards(AuthGuard, PermissionsGuard)
export class WebhooksController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  create(@TenantId() tenantId: string, @Body() body: { name: string; url: string; events: string[] }) {
    return this.webhookService.createWebhook(tenantId, body)
  }

  @Get()
  list(@TenantId() tenantId: string) {
    return this.webhookService.listWebhooks(tenantId)
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: any) {
    return this.webhookService.updateWebhook(tenantId, id, body)
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.webhookService.deleteWebhook(tenantId, id)
  }

  @Post('replay')
  replay(@TenantId() tenantId: string, @Body() body: { event?: string }) {
    return this.webhookService.replayFailed(tenantId, body.event)
  }
}
