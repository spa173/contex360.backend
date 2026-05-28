import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupVerificationService } from './backup-verification.service';

@Injectable()
export class BackupVerificationScheduler {
  private readonly logger = new Logger(BackupVerificationScheduler.name);

  constructor(
    private readonly backupVerificationService: BackupVerificationService,
  ) {}

  /**
   * Run backup verification daily at 4 AM (2 hours after backup)
   * Verifies the integrity of the latest backup
   */
  @Cron('0 4 * * *', { timeZone: 'America/Bogota' })
  async runDailyBackupVerification() {
    if (process.env.BACKUP_ENABLED !== 'true') {
      this.logger.debug('Backup verification skipped: backups disabled');
      return;
    }

    this.logger.log('Starting daily backup verification...');

    try {
      const result = await this.backupVerificationService.verifyLatestBackup();

      if (result.valid) {
        this.logger.log(`Backup verification successful: ${result.message}`);
        if (result.backupFile) {
          this.logger.log(`Verified backup file: ${result.backupFile}`);
        }
      } else {
        this.logger.error(`Backup verification failed: ${result.message}`);
        // Optionally send alert to administrators
        this.alertAdministrators(`Backup verification FAILED: ${result.message}`);
      }
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Error during backup verification:`, err);
      this.alertAdministrators(`Backup verification ERROR: ${err.message}`);
      // Re-throw to ensure scheduler failure is noticed
      throw err;
    }
  }

  /**
   * Send alert to administrators about backup issues
   */
  private async alertAdministrators(message: string): Promise<void> {
    try {
      // In a real implementation, this would send email/SMS/Slack alerts
      // For now, we'll just log it as a warning
      this.logger.warn(`ADMIN ALERT: ${message}`);

      // Example implementation (would need notification service):
      // await this.notificationService.sendGenericEmail(
      //   process.env.ADMIN_ALERT_EMAIL || 'admin@contex360.com',
      //   'Backup Verification Failed',
      //   message
      // );
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Failed to send administrator alert:`, err);
    }
  }
}