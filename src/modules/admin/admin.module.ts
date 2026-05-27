import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AccessReviewScheduler } from './access-review.scheduler'
import { BackupScheduler } from './backup.scheduler'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AccessReviewScheduler, BackupScheduler],
})
export class AdminModule {}
