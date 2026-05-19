import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaModule } from '../database/prisma.module';
import { WompiService } from './wompi.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, WompiService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
