import { Injectable } from '@nestjs/common'

@Injectable()
export class HealthService {
  getStatus() {
    return {
      status: 'ok',
      service: 'contex360-backend',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    }
  }
}

