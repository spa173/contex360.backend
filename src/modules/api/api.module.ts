import { Module } from '@nestjs/common'
import { ApiKeysService } from './api-keys.service'
import { WebhookService } from './webhook.service'
import { ApiKeysController, PublicApiController } from './api.controller'
import { WebhooksController } from './webhook.controller'

@Module({
  controllers: [ApiKeysController, PublicApiController, WebhooksController],
  providers: [ApiKeysService, WebhookService],
  exports: [ApiKeysService, WebhookService],
})
export class ApiModule {}
