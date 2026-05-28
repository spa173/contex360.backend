import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { AuthGuard } from '../auth/auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

@Controller('privacy')
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Post('consent')
  async registrarConsent(
    @TenantId() tenantId: string,
    @Body() body: { userId: string; type: string; estado: string },
  ) {
    return this.privacyService.registrarConsentimiento(
      tenantId,
      body.userId,
      body.type,
      body.estado,
    );
  }

  @Get('consents/:userId')
  async listarConsents(@TenantId() tenantId: string, @Param('userId') userId: string) {
    return this.privacyService.getConsentimientos(tenantId, userId);
  }

  @Post('solicitud-derechos')
  async crearSolicitud(
    @TenantId() tenantId: string,
    @Body() body: { userId: string; tipo: string; solicitante: string; email: string; ip?: string },
  ) {
    return this.privacyService.createSolicitudDerechos({
      tenantId,
      userId: body.userId,
      tipo: body.tipo,
      solicitante: body.solicitante,
      emailSolicitante: body.email,
      ip: body.ip,
    });
  }

  @Post('solicitud-derechos/:id/resolver')
  async resolverSolicitud(
    @Param('id') id: string,
    @Body() body: { estado: string },
  ) {
    return this.privacyService.updateSolicitudDerechos(id, body.estado, new Date());
  }
}
