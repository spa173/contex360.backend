import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { execSync } from 'node:child_process'

const CRON_TIME = process.env.BACKUP_SCHEDULE || '0 2 * * *';
const TIMEZONE = 'America/Bogota';

@Injectable()
export class BackupScheduler {
  private readonly logger = new Logger(BackupScheduler.name)
  private readonly cronTime: string = CRON_TIME
  private readonly timezone: string = TIMEZONE

  /**
   * Backup diario basado en la variable de entorno BACKUP_SCHEDULE (por defecto: 0 2 * * * a las 2:00 AM hora de Colombia)
   * RPO (Recovery Point Objective): Hasta 24 horas (si se ejecuta diariamente) o según la frecuencia del schedule.
   * RTO (Recovery Time Objective): Menos de 2 horas (dependiendo del tamaño de la backup y la infraestructura).
   */
  @Cron(CRON_TIME, { timeZone: TIMEZONE })
  async runDailyBackup() {
    if (process.env.BACKUP_ENABLED !== 'true') {
      this.logger.debug('Backups deshabilitados (BACKUP_ENABLED != true)')
      return
    }

    // Calculate RPO based on cron expression (simplified: if daily, RPO is 24 hours)
    const rpoHours = this.calculateRPOHours()
    this.logger.log(`Iniciando backup diario de base de datos...`)
    this.logger.log(`RPO (Recovery Point Objective): Hasta ${rpoHours} horas`)
    this.logger.log(`RTO (Recovery Time Objective): Menos de 2 horas (objetivo)`)

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

  /**
   * Calculate approximate RPO in hours based on cron expression.
   * This is a simplified implementation for common schedules.
   */
  private calculateRPOHours(): number {
    if (this.cronTime.includes('*/5')) {
      return 0.08 // 5 minutes
    }
    if (this.cronTime.includes('0 */1') || this.cronTime.includes('0 * * * *')) {
      return 1 // Hourly backup
    }
    if (this.cronTime.includes('0 0 * * 0') || this.cronTime.includes('0 0 * * 7')) {
      return 168 // Weekly backup
    }
    // If the cron expression contains a fixed hour and minute (like '0 2 * * *'), it's daily.
    if (/^\d+\s+\d+\s+\*\s+\*\s+\*$/.test(this.cronTime)) {
      return 24 // Daily backup
    }
    return 12 // Default fallback if not matched
  }
}
