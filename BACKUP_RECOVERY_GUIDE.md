# Contex360 Backup & Disaster Recovery Guide

## Overview

This document describes the backup and disaster recovery system implemented for Contex360, including backup scheduling, verification, and restoration procedures.

## Backup System Components

### 1. Backup Scheduler (`src/modules/admin/backup.scheduler.ts`)
- Runs daily based on `BACKUP_SCHEDULE` environment variable (default: `0 2 * * *` - 2:00 AM Colombia time)
- Uses `BACKUP_ENABLED` flag to enable/disable backups
- Executes the backup script: `scripts/backup-db.ts`

### 2. Backup Script (`scripts/backup-db.ts`)
- Creates compressed PostgreSQL backups using `pg_dump` and `gzip`
- Stores backups locally in `./backups` directory (configurable via `BACKUP_DIR`)
- Optional upload to S3/R2 compatible storage
- Automatic cleanup of old backups based on retention policies:
  - Daily backups: kept for 7 days
  - Weekly backups: kept for 4 weeks (only Sunday backups)

### 3. Backup Verification Service (`src/modules/admin/backup-verification.service.ts`)
- Verifies backup integrity by:
  1. Creating a temporary database
  2. Restoring the backup to the temporary database
  3. Running a simple verification query (`SELECT COUNT(*) FROM tenant`)
  4. Cleaning up the temporary database

### 4. Backup Verification Scheduler (`src/modules/admin/backup-verification.scheduler.ts`)
- Runs daily at 4:00 AM Colombia time (2 hours after backup)
- Verifies the integrity of the latest backup
- Logs results and alerts administrators on failure

### 5. Backup Restore Service (`src/modules/admin/backup-restore.service.ts`)
- Provides methods to restore backups:
  - `restoreLatestBackup(targetDbName)`: Restores the most recent backup
  - `restoreBackupByName(backupName, targetDbName)`: Restores a specific backup
- Handles database creation/dropping as needed

## Recovery Objectives

### RPO (Recovery Point Objective)
- **Definition**: Maximum targeted period in which data might be lost due to a major incident.
- **Current Implementation**: 
  - With default daily schedule: **24 hours**
  - Configurable via `BACKUP_SCHEDULE` environment variable
  - Example: To achieve 4-hour RPO, set `BACKUP_SCHEDULE="0 */4 * * *"` (every 4 hours)

### RTO (Recovery Time Objective)
- **Definition**: Targeted time to recover and restore business operations after a disruption.
- **Current Implementation**: 
  - **Less than 2 hours** (objective)
  - Factors affecting actual RTO:
    - Backup file size
    - Database server performance
    - Network speed (if restoring from remote storage)
    - Verification process time

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKUP_ENABLED` | Enable/disable backup system | `false` |
| `BACKUP_SCHEDULE` | Cron schedule for backups | `0 2 * * *` |
| `BACKUP_DIR` | Local backup directory | `./backups` |
| `BACKUP_BUCKET` | S3/R2 bucket name (optional) | - |
| `BACKUP_ACCESS_KEY` | S3/R2 access key (optional) | - |
| `BACKUP_SECRET_KEY` | S3/R2 secret key (optional) | - |
| `BACKUP_REGION` | S3/R2 region | `us-east-1` |
| `BACKUP_ENDPOINT` | Custom S3 endpoint (for R2, etc.) | - |
| `RETENTION_DAYS` | Days to keep daily backups | `7` |
| `RETENTION_WEEKLY` | Weeks to keep weekly backups | `4` |

## Using the Backup System

### Manual Backup Creation
```bash
# Create a backup manually
npx ts-node scripts/backup-db.ts

# The script will:
# 1. Create a compressed backup file
# 2. Upload to S3/R2 if configured
# 3. Clean up old backups based on retention policies
```

### Verifying Backup Integrity
```bash
# Manual verification (also runs automatically via scheduler)
npx ts-node -r tsconfig-paths/register -e "
import { BackupVerificationService } from './src/modules/admin/backup-verification.service';
import { PrismaService } from './src/modules/database/prisma.service';

async function verify() {
  const prisma = new PrismaService();
  const verifier = new BackupVerificationService(prisma);
  const result = await verifier.verifyLatestBackup();
  console.log('Verification result:', result);
  await prisma.$disconnect();
}

verify().catch(console.error);
"
```

### Restoring from Backup

#### Latest Backup
```bash
# Using the restore service programmatically
import { BackupRestoreService } from './src/modules/admin/backup-restore.service';
import { PrismaService } from './src/modules/database/prisma.service';

async function restoreLatest() {
  const prisma = new PrismaService();
  const restoreService = new BackupRestoreService(prisma);
  
  const result = await restoreService.restoreLatestBackup('recovery_db');
  console.log('Restore result:', result);
  
  await prisma.$disconnect();
}

restoreLatest().catch(console.error);
```

#### Specific Backup
```bash
async restoreSpecific() {
  const prisma = new PrismaService();
  const restoreService = new BackupRestoreService(prisma);
  
  const result = await restoreService.restoreBackupByName(
    'contex360-backup-2024-01-15-02-00-00.sql.gz',
    'recovery_db'
  );
  console.log('Restore result:', result);
  
  await prisma.$disconnect();
}

restoreSpecific().catch(console.error);
```

#### Using the Command Line
You can also create a simple script for restoration:
```typescript
// scripts/restore-db.ts
import { BackupRestoreService } from '../src/modules/admin/backup-restore.service';
import { PrismaService } from '../src/modules/database/prisma.service';

async function main() {
  const prisma = new PrismaService();
  const restoreService = new BackupRestoreService(prisma);
  
  const args = process.argv.slice(2);
  let result;
  
  if (args.length === 0) {
    // Restore latest
    result = await restoreService.restoreLatestBackup('recovered_db');
  } else if (args.length === 1) {
    // Restore specific backup by name
    result = await restoreService.restoreBackupByName(args[0], 'recovered_db');
  } else {
    console.log('Usage: npx ts-node scripts/restore-db.ts [backup-file-name]');
    process.exit(1);
  }
  
  console.log('Restore result:', result);
  await prisma.$disconnect();
}

main().catch(console.error);
```

Then run:
```bash
# Restore latest backup
npx ts-node scripts/restore-db.ts

# Restore specific backup
npx ts-node scripts/restore-db.tex contex360-backup-2024-01-15-02-00-00.sql.gz
```

## Monitoring and Alerts

### Logs
All backup operations log to the application logger:
- Backup start/completion/failure
- Verification results
- Cleanup activities

### Administrator Alerts
When backup verification fails, the system logs warnings that can be picked up by monitoring systems.
To implement actual notifications (email, Slack, etc.), extend the `alertAdministrators` method in:
`src/modules/admin/backup-verification.scheduler.ts`

## Testing the Backup System

1. **Enable backups**: Set `BACKUP_ENABLED=true` in your environment
2. **Run manual backup**: `npx ts-node scripts/backup-db.ts`
3. **Verify backup**: Check logs for successful completion
4. **Test restoration**: Use the restore methods above to verify you can recover data
5. **Check scheduler logs**: Verify the daily backup and verification jobs run at their scheduled times

## Disaster Recovery Procedure

In case of database loss or corruption:

1. **Do not panic** - your data is backed up
2. **Determine recovery point**: Identify which backup to use (latest or specific point-in-time)
3. **Prepare recovery environment**:
   - Ensure PostgreSQL is running
   - Create a new database for recovery (or identify target database)
4. **Restore backup**:
   - Use the restore service or manual script
   - Verify the restored data is correct
5. **Switch applications**:
   - Update DATABASE_URL to point to recovered database
   - Restart application services
6. **Verify operations**:
   - Check that the application functions correctly
   - Confirm data integrity

## Limitations and Considerations

1. **Storage Requirements**: Ensure sufficient storage for backups based on retention policy and database size
2. **Performance Impact**: Backups run on the primary database - monitor performance during backup windows
3. **Security**: Backup files contain sensitive data - ensure backup storage is secured
4. **Test Regularly**: Regularly test restore procedures to ensure they work when needed
5. **Off-site Copies**: Consider copying backups to off-site locations for catastrophic scenarios
6. **Backup Validation**: The verification service performs basic validation - consider more comprehensive tests for critical data

## Troubleshooting

### Common Issues

**Backup fails with timeout**
- Increase timeout in backup scheduler or check database performance
- Consider backing up during off-peak hours

**Verification fails but backup appears good**
- Check temporary database creation permissions
- Ensure sufficient resources for temporary database
- Verify the verification query works on your schema

**Restoration fails**
- Check that pg_dump and psql versions are compatible
- Ensure adequate disk space for both backup and restored database
- Verify PostgreSQL service is running

**S3/R2 upload fails**
- Check credentials and permissions
- Verify network connectivity to storage endpoint
- Confirm bucket exists and is accessible

### Logs to Check
- Application logs for backup scheduler messages
- Console output when running scripts manually
- Database logs for connection issues during backup/restore