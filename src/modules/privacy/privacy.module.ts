import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { DataRetentionService } from './data-retention.service';
import { PrismaService } from '../database/prisma.service';

@Module({
  controllers: [PrivacyController],
  providers: [PrivacyService, DataRetentionService, PrismaService],
  exports: [PrivacyService, DataRetentionService],
})
export class PrivacyModule {}
