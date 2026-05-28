import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'
import { AnalyticsModule } from '../analytics/analytics.module'
import { NotificationModule } from '../notification/notification.module'
import { UsageModule } from '../usage/usage.module'

@Module({
  imports: [AnalyticsModule, NotificationModule, UsageModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
