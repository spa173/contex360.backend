import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger'
import { SkipOnboardingCheck } from '../../common/decorators/skip-onboarding.decorator'
import { Public } from '../auth/public.decorator'
import { HealthService } from './health.service'

@ApiTags('Health')
@Controller('health')
@SkipOnboardingCheck()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Verificar estado del servidor y dependencias' })
  @ApiResponse({ status: 200, description: 'Servidor funcionando correctamente' })
  @ApiResponse({ status: 503, description: 'Servidor degradado o con fallos' })
  async check() {
    return this.healthService.getStatus()
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Página pública de estado del servicio (status.contex360.com)' })
  @ApiResponse({ status: 200, description: 'Estado del servicio' })
  async publicStatus() {
    const status = await this.healthService.getStatus()
    return {
      service: 'Contex360 ERP',
      status: status.status,
      timestamp: status.timestamp,
      uptimeSeconds: status.uptimeSeconds,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: status.database,
      incidents: [],
      scheduledMaintenance: [],
    }
  }

  @Public()
  @Get('sla')
  @ApiOperation({ summary: 'Estado del SLA — disponibilidad, incidentes activos y métricas de uptime' })
  @ApiResponse({ status: 200, description: 'Métricas de SLA del servicio' })
  async sla() {
    return this.healthService.getSlaStatus()
  }

  @Public()
  @Get('sla/incidents')
  @ApiOperation({ summary: 'Historial de incidentes del servicio' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista de incidentes' })
  async slaIncidents(
    @Query('limit', new DefaultValuePipe(20), new ParseIntPipe({ optional: true })) limit: number,
    @Query('offset', new DefaultValuePipe(0), new ParseIntPipe({ optional: true })) offset: number,
  ) {
    return this.healthService.getIncidents(limit, offset)
  }
}
