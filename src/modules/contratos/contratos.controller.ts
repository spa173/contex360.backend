import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { AuthGuard } from '../auth/auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import type { AuthTokenPayload } from '../auth/auth.types';

@Controller('contratos')
@UseGuards(AuthGuard)
export class ContratosController {
  constructor(private readonly contratosService: ContratosService) {}

  @Post()
  async crear(
    @TenantId() tenantId: string,
    @Body() body: { tipo: string; version: string; titulo: string; cuerpo: string },
  ) {
    return this.contratosService.crearContrato({
      tenantId,
      ...body,
    });
  }

  @Get()
  async listar(@TenantId() tenantId: string) {
    return this.contratosService.getContratos(tenantId);
  }

  @Get('activo/:tipo')
  async getActivo(@TenantId() tenantId: string, @Param('tipo') tipo: string) {
    return this.contratosService.getContratoActivo(tenantId, tipo);
  }

  @Get('pendientes')
  async getPendientes(@TenantId() tenantId: string, @AuthUser() user: AuthTokenPayload) {
    return this.contratosService.pendientes(tenantId, user.sub);
  }

  @Post(':id/aceptar')
  async aceptar(
    @TenantId() tenantId: string,
    @Param('id') contratoId: string,
    @AuthUser() user: AuthTokenPayload,
    @Body() body: { ip?: string; dispositivo?: string },
  ) {
    return this.contratosService.aceptarContrato(contratoId, user.sub, tenantId, body.ip, body.dispositivo);
  }

  @Get(':id/aceptaciones')
  async aceptaciones(@Param('id') contratoId: string) {
    return this.contratosService.getAceptaciones(contratoId);
  }

  @Get(':id/verificar')
  async verificar(@Param('id') contratoId: string, @AuthUser() user: AuthTokenPayload) {
    const aceptado = await this.contratosService.verificarAceptacion(contratoId, user.sub);
    return { aceptado };
  }

  @Post('seed')
  async seedContratos(@TenantId() tenantId: string) {
    return this.contratosService.seedContratosPredeterminados(tenantId);
  }
}
