import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AccessReviewScheduler } from './access-review.scheduler'
import { BackupScheduler } from './backup.scheduler'
import { BackupVerificationService } from './backup-verification.service'
import { BackupVerificationScheduler } from './backup-verification.scheduler'
import { BackupRestoreService } from './backup-restore.service'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AccessReviewScheduler,
    BackupScheduler,
    BackupVerificationService,
    BackupVerificationScheduler,
    BackupRestoreService,
  ],
  exports: [BackupRestoreService, BackupVerificationService],
})
export class AdminModule {}
