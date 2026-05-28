import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { PrismaService } from '../database/prisma.service';
import { PdfService } from './pdf.service';
import { SubscriptionMailerService } from './subscription-mailer.service';
import { ChurnDetectionService } from './churn-detection.service';
import { CurrencyService } from './currency.service';
import { DianModule } from '../dian/dian.module';
import { NotificationModule } from '../notification/notification.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [DianModule, NotificationModule, UsageModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PdfService, SubscriptionMailerService, ChurnDetectionService, CurrencyService],
  exports: [SubscriptionsService, ChurnDetectionService, CurrencyService],
})
export class SubscriptionsModule {}
