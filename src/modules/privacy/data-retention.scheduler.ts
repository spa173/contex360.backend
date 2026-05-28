import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataRetentionService } from './data-retention.service';

@Injectable()
export class DataRetentionScheduler {
  private readonly logger = new Logger(DataRetentionScheduler.name);

  constructor(
    private readonly dataRetentionService: DataRetentionService,
  ) {}

  /**
   * Run data retention policy monthly on the first day at 2 AM
   * Deletes data for tenants inactive for 24+ months (LGPD compliance)
   */
  @Cron('0 2 1 * *', { timeZone: 'America/Bogota' })
  async runMonthlyDataRetention() {
    this.logger.log('Starting monthly data retention policy execution...');
    
    try {
      const result = await this.dataRetentionService.deleteInactiveTenants(24);
      
      if (result.deletedCount > 0) {
        this.logger.log(`Data retention completed: ${result.deletedCount} tenants deleted`);
      } else {
        this.logger.log('Data retention completed: No inactive tenants found for deletion');
      }
    } catch (error) {
      this.logger.error(`Error during data retention policy execution:`, error);
      // Re-throw to ensure the scheduler failure is logged and monitored
      throw error;
    }
  }

  /**
   * Run quarterly audit of data retention statistics
   */
  @Cron('0 3 1 */3 *', { timeZone: 'America/Bogota' })
  async runQuarterlyRetentionAudit() {
    this.logger.log('Running quarterly data retention audit...');
    
    try {
      const stats = await this.dataRetentionService.getRetentionStatistics();
      
      this.logger.log(`Data retention statistics:`, {
        totalTenants: stats.totalTenants,
        inactiveTenants24m: stats.inactiveTenants24m,
        inactiveTwelveMonths: stats.inactiveTwelveMonths,
        inactiveSixMonths: stats.inactiveSixMonths
      });

      // Optionally send report to administrators
      if (process.env.RETENTION_REPORT_EMAIL) {
        // Implementation would go here to send email report
      }
    } catch (error) {
      this.logger.error(`Error during data retention audit:`, error);
      throw error;
    }
  }
}