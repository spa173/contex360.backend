import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaModule } from '../database/prisma.module';
import { WompiService } from './wompi.service';
import { TrialGuard } from './trial.guard';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, WompiService, TrialGuard],
  exports: [SubscriptionsService, TrialGuard],
})
export class SubscriptionsModule {}
