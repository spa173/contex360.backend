import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { execSync } from 'node:child_process'

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name)

  /**
   * Backup diario a las 2:00 AM (hora de Colombia)
   * Cron: 0 2 * * *
   */
  @Cron('0 2 * * *', { timeZone: 'America/Bogota' })
  async runDailyBackup() {
    if (process.env.BACKUP_ENABLED !== 'true') {
      this.logger.debug('Backups deshabilitados (BACKUP_ENABLED != true)')
      return
    }

    this.logger.log('Iniciando backup diario de base de datos...')

    try {
      const { join } = await import('node:path')
      const tsNodeBin = join(process.cwd(), 'node_modules', 'ts-node', 'dist', 'bin.js')
      execSync(`"${process.execPath}" "${tsNodeBin}" scripts/backup-db.ts`, {
        encoding: 'utf8',
        timeout: 300000, // 5 minutes
        cwd: process.cwd(),
      })
      this.logger.log('Backup diario completado exitosamente.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      this.logger.error(`Backup diario falló: ${message}`)
    }
  }
}
