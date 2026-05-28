import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../database/prisma.service';

interface BackupFile {
  name: string;
  path: string;
  time: number;
}

@Injectable()
export class BackupRestoreService {
  private readonly logger = new Logger(BackupRestoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get list of backup files sorted by modification time (newest first).
   */
  private getBackupFiles(backupDir: string): BackupFile[] {
    if (!existsSync(backupDir)) {
      return [];
    }

    const files = require('fs').readdirSync(backupDir)
      .filter((f: string) => f.startsWith('contex360-backup-') && f.endsWith('.sql.gz'))
      .map((f: string) => ({
        name: f,
        path: join(backupDir, f),
        time: require('fs').statSync(join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a: BackupFile, b: BackupFile) => b.time - a.time);

    return files;
  }

  /**
   * Restore the latest backup to a target database.
   * @param targetDbName Target database name (will be overwritten if exists)
   * @returns {Promise<{ success: boolean; message: string; restoredFrom?: string }>}
   */
  async restoreLatestBackup(targetDbName: string): Promise<{ success: boolean; message: string; restoredFrom?: string }> {
    try {
      const backupDir = process.env.BACKUP_DIR || './backups';
      if (!existsSync(backupDir)) {
        return { success: false, message: `Backup directory does not exist: ${backupDir}` };
      }

      // Find the latest backup file
      const backupFiles = this.getBackupFiles(backupDir);
      if (backupFiles.length === 0) {
        return { success: false, message: 'No backup files found' };
      }

      const latestBackup = backupFiles[0]; // Already sorted by time descending
      this.logger.log(`Restoring latest backup: ${latestBackup.name}`);

      // Perform the restore
      await this.restoreBackupToDatabase(latestBackup.path, targetDbName);

      return { 
        success: true, 
        message: `Successfully restored from backup: ${latestBackup.name}`,
        restoredFrom: latestBackup.name 
      };
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Error restoring backup:`, err);
      return { 
        success: false, 
        message: `Failed to restore backup: ${err.message}` 
      };
    }
  }

  /**
   * Restore a specific backup file to a target database.
   * @param backupName Name of the backup file to restore
   * @param targetDbName Target database name (will be overwritten if exists)
   * @returns {Promise<{ success: boolean; message: string }>}
   */
  async restoreBackupByName(backupName: string, targetDbName: string): Promise<{ success: boolean; message: string }> {
    try {
      const backupDir = process.env.BACKUP_DIR || './backups';
      if (!existsSync(backupDir)) {
        return { success: false, message: `Backup directory does not exist: ${backupDir}` };
      }

      // Find the specific backup file
      const backupFiles = this.getBackupFiles(backupDir);
      const backupFile = backupFiles.find(f => f.name === backupName);
      
      if (!backupFile) {
        return { success: false, message: `Backup file not found: ${backupName}` };
      }

      this.logger.log(`Restoring backup ${backupName} to database ${targetDbName}`);

      // Perform the restore
      await this.restoreBackupToDatabase(backupFile.path, targetDbName);

      return { 
        success: true, 
        message: `Successfully restored from backup: ${backupName}` 
      };
    } catch (error: any) {
      const err = error as Error;
      this.logger.error(`Error restoring backup by name:`, err);
      return { 
        success: false, 
        message: `Failed to restore backup: ${err.message}` 
      };
    }
  }

  /**
   * Restore a backup file to a database.
   * @param backupPath Path to the backup file (.sql.gz)
   * @param targetDbName Target database name (will be overwritten if exists)
   */
  private async restoreBackupToDatabase(backupPath: string, targetDbName: string): Promise<void> {
    this.logger.log(`Restoring backup ${backupPath} to target database ${targetDbName}`);

    // Drop the target database if it exists (to avoid conflicts)
    try {
      await this.dropDatabase(targetDbName);
    } catch (error: any) {
      // Ignore if the database doesn't exist
      const err = error as Error;
      this.logger.warn(`Target database ${targetDbName} does not exist or could not be dropped: ${err.message}`);
    }

    // Create the target database
    await this.createDatabase(targetDbName);

    // Restore the backup
    await this.restoreBackup(backupPath, targetDbName);

    this.logger.log(`Successfully restored backup to ${targetDbName}`);
  }

  /**
   * Create a PostgreSQL database.
   */
  private async createDatabase(dbName: string): Promise<void> {
    // Extract connection details from DATABASE_URL to connect to default postgres DB
    const { URL } = await import('node:url');
    const dbUrl = new URL(process.env.DATABASE_URL || '');
    
    // Connect to default postgres database to create new database
    const dbNameToConnect = dbUrl.pathname.substring(1); // Remove leading slash
    const adminUrl = dbUrl.toString().replace(`/${dbNameToConnect}`, '/postgres');
    
    const command = `createdb "${dbName}" --host=${dbUrl.hostname} --port=${dbUrl.port || 5432} --username=${dbUrl.username}`;
    execSync(command, { stdio: 'pipe', env: { ...process.env, PGPASSWORD: dbUrl.password || '' } });
  }

  /**
   * Drop a PostgreSQL database.
   */
  private async dropDatabase(dbName: string): Promise<void> {
    // Extract connection details from DATABASE_URL to connect to default postgres DB
    const { URL } = await import('node:url');
    const dbUrl = new URL(process.env.DATABASE_URL || '');
    
    // Connect to default postgres database to drop database
    const dbNameToConnect = dbUrl.pathname.substring(1); // Remove leading slash
    const adminUrl = dbUrl.toString().replace(`/${dbNameToConnect}`, '/postgres');
    
    const command = `dropdb "${dbName}" --host=${dbUrl.hostname} --port=${dbUrl.port || 5432} --username=${dbUrl.username}`;
    execSync(command, { stdio: 'pipe', env: { ...process.env, PGPASSWORD: dbUrl.password || '' } });
  }

  /**
   * Restore a backup file to a database.
   * @param backupPath Path to the .sql.gz backup file
   * @param dbName Target database name
   */
  private async restoreBackup(backupPath: string, dbName: string): Promise<void> {
    this.logger.log(`Restoring backup ${backupPath} to database ${dbName}`);

    // Extract connection details from DATABASE_URL
    const { URL } = await import('node:url');
    const dbUrl = new URL(process.env.DATABASE_URL || '');
    
    // We'll use gunzip to decompress and pipe to psql
    const { execFile } = await import('node:child_process');
    // Decompress and restore in one pipeline
    const gunzip = require('child_process').execSync('gunzip', { 
      input: require('fs').readFileSync(backupPath), 
      maxBuffer: 1024 * 1024 * 50 // 50MB buffer
    });

    // Now restore to the database
    const restoreCommand = `psql "host=${dbUrl.hostname} port=${dbUrl.port || 5432} dbname=${dbName} user=${dbUrl.username}"`;
    execSync(restoreCommand, { 
      input: gunzip, 
      maxBuffer: 1024 * 1024 * 50,
      env: { ...process.env, PGPASSWORD: dbUrl.password || '' }
    });
  }
}