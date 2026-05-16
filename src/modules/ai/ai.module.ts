import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { AiController } from './ai.controller'
import { AnalyticsModule } from '../analytics/analytics.module'
import { NotificationModule } from '../notification/notification.module'

@Module({
  imports: [AnalyticsModule, NotificationModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
