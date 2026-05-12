import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AdminService } from './admin.service'

@Injectable()
export class AccessReviewScheduler {
  private readonly logger = new Logger(AccessReviewScheduler.name)

  constructor(private readonly adminService: AdminService) {}

  @Cron('0 0 8 1 * *', { timeZone: 'America/Bogota' })
  async runMonthlyAccessReview() {
    try {
      await this.adminService.runAccessReview('scheduled')
      this.logger.log('Revision periodica de accesos completada.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      this.logger.error(`No se pudo ejecutar la revision periodica de accesos: ${message}`)
    }
  }
}
