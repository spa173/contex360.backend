import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../database/prisma.service';

interface BackupFile {
  name: string;
  path: string;
  time: number;
}

@Injectable()
export class BackupVerificationService {
  private readonly logger = new Logger(BackupVerificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify the integrity of the latest backup file.
   * @returns {Promise<{ valid: boolean; message: string; backupFile?: string }>}
   */
  async verifyLatestBackup(): Promise<{ valid: boolean; message: string; backupFile?: string }> {
    try {
      const backupDir = process.env.BACKUP_DIR || './backups';
      if (!existsSync(backupDir)) {
        return { valid: false, message: `Backup directory does not exist: ${backupDir}` };
      }

      // Find the latest backup file
      const backupFiles = this.getBackupFiles(backupDir);
      if (backupFiles.length === 0) {
        return { valid: false, message: 'No backup files found' };
      }

      const latestBackup = backupFiles[0]; // Already sorted by time descending
      this.logger.log(`Verifying backup: ${latestBackup.name}`);

      // Create a temporary database for verification
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const tempDbName = `contex360_verify_${timestamp}`;

      try {
        // Create temporary database
        this.createDatabase(tempDbName);

        // Restore the backup to the temporary database
        await this.restoreBackup(latestBackup.path, tempDbName);

        // Run a simple verification query
        const isValid = await this.verifyDatabase(tempDbName);

        if (isValid) {
          this.logger.log(`Backup verification successful: ${latestBackup.name}`);
          return { valid: true, message: 'Backup is valid and restorable', backupFile: latestBackup.name };
        } else {
          return { valid: false, message: 'Backup restoration succeeded but verification query failed' };
        }
      } catch (error: any) {
        const err = error as Error;
        this.logger.error(`Backup verification failed:`, err);
        return { valid: false, message: `Backup verification failed: ${err.message}` };
      } finally {
        // Clean up: drop the temporary database
        try {
          this.dropDatabase(tempDbName);
        } catch (cleanupError) {
          this.logger.warn(`Failed to drop temporary database ${tempDbName}:`, cleanupError);
        }
      }
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Error during backup verification:`, err);
      return { valid: false, message: `Unexpected error during backup verification: ${err.message}` };
    }
  }

  /**
   * Get list of backup files sorted by modification time (newest first).
   */
  private getBackupFiles(backupDir: string): BackupFile[] {
    const files = readdirSync(backupDir)
      .filter((f: string) => f.startsWith('contex360-backup-') && f.endsWith('.sql.gz'))
      .map((f: string) => ({
        name: f,
        path: join(backupDir, f),
        time: statSync(join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a: BackupFile, b: BackupFile) => b.time - a.time);

    return files;
  }

  /**
   * Create a PostgreSQL database.
   */
  private createDatabase(dbName: string): void {
    const command = `createdb "${dbName}"`;
    execSync(command, { stdio: 'pipe' });
  }

  /**
   * Drop a PostgreSQL database.
   */
  private dropDatabase(dbName: string): void {
    const command = `dropdb "${dbName}"`;
    execSync(command, { stdio: 'pipe' });
  }

  /**
   * Restore a backup file to a database.
   * @param backupPath Path to the .sql.gz backup file
   * @param dbName Target database name
   */
  private async restoreBackup(backupPath: string, dbName: string): Promise<void> {
    this.logger.log(`Restoring backup ${backupPath} to database ${dbName}`);

    // We'll use gunzip to decompress and pipe to psql
    const { execFile } = await import('node:child_process');
    // Note: We are using execSync for simplicity, but for large files we might want to use streams.
    // However, the backup file is already compressed and we are in a controlled environment.

    // First, decompress and then pipe to psql
    const gunzip = execSync('gunzip', { input: require('node:fs').readFileSync(backupPath), maxBuffer: 1024 * 1024 * 50 }); // 50MB buffer

    // Now restore to the database
    const dbUrl = process.env.DATABASE_URL || '';
    const restoreCommand = `psql "${dbUrl.replace(/\/[^\/]+$/, `/${dbName}`)}"`;
    execSync(restoreCommand, { input: gunzip, maxBuffer: 1024 * 1024 * 50 });
  }

  /**
   * Run a simple verification query on the database.
   * @param dbName Database name to verify
   * @returns {Promise<boolean>} True if verification succeeds
   */
  private async verifyDatabase(dbName: string): Promise<boolean> {
    // We'll use Prisma to connect to the temporary database and run a simple query.
    // Note: We need to create a temporary Prisma client for the temporary database.
    // For simplicity, we'll just execute a SQL query via psql.

    const dbUrl = process.env.DATABASE_URL || '';
    const query = 'SELECT COUNT(*) FROM tenant;';
    const command = `psql "${dbUrl.replace(/\/[^\/]+$/, `/${dbName}`)}" -c "${query}" -t -A`;

    try {
      const result = execSync(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      const count = Number.parseInt(result.trim(), 10);
      this.logger.log(`Verification query result: ${count} tenants found`);
      return !Number.isNaN(count); // If we got a number, the query succeeded
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Verification query failed:`, err);
      return false;
    }
  }

  /**
   * Restore a backup to a target database (for disaster recovery).
   * @param backupPath Path to the backup file (.sql.gz)
   * @param targetDbName Target database name (will be overwritten if exists)
   */
  async restoreBackupToDatabase(backupPath: string, targetDbName: string): Promise<void> {
    this.logger.log(`Restoring backup ${backupPath} to target database ${targetDbName}`);

    // Drop the target database if it exists (to avoid conflicts)
    try {
      this.dropDatabase(targetDbName);
    } catch (error: any) {
      // Ignore if the database doesn't exist
      const err = error as Error;
      this.logger.warn(`Target database ${targetDbName} does not exist or could not be dropped: ${err.message}`);
    }

    // Create the target database
    this.createDatabase(targetDbName);

    // Restore the backup
    await this.restoreBackup(backupPath, targetDbName);

    this.logger.log(`Successfully restored backup to ${targetDbName}`);
  }
}