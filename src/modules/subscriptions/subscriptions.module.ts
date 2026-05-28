import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { WompiService } from './wompi.service';
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
  providers: [SubscriptionsService, WompiService, PdfService, SubscriptionMailerService, ChurnDetectionService, CurrencyService, PrismaService],
  exports: [SubscriptionsService, WompiService, ChurnDetectionService, CurrencyService],
})
export class SubscriptionsModule {}
