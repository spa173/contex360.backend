import { BadRequestException, Body, Controller, Delete, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { Response } from 'express'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { Public } from '../auth/public.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthenticatedRequest } from '../auth/auth.types'
import { BancolombiaConfigDto, BancolombiaSyncDto } from './bancolombia.types'
import { BancolombiaConfigSnapshot, BancolombiaService, BancolombiaSyncResponse, BancolombiaUpdateResponse } from './bancolombia.service'

function escapeForHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

@Controller('integrations/bancolombia')
export class BancolombiaController {
  constructor(private readonly bancolombiaService: BancolombiaService) {}

  @Get('config')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  getConfig(@TenantId() tenantId: string): Promise<BancolombiaConfigSnapshot> {
    return this.bancolombiaService.getConfig(tenantId)
  }

  @Post('config')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  updateConfig(
    @TenantId() tenantId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: BancolombiaConfigDto,
  ): Promise<BancolombiaUpdateResponse> {
    if (!req.authUser) {
      throw new BadRequestException('Usuario autenticado requerido.')
    }

    return this.bancolombiaService.updateConfig(tenantId, req.authUser.sub, body)
  }

  @Post('connect')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  connect(@TenantId() tenantId: string, @Req() req: AuthenticatedRequest) {
    if (!req.authUser) {
      throw new BadRequestException('Usuario autenticado requerido.')
    }

    return this.bancolombiaService.startConnect(tenantId, req.authUser.sub)
  }

  @Get('callback')
  @Public()
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.bancolombiaService.handleCallback(code, state)
      const payload = {
        type: 'bancolombia-connected',
        accountNumber: result.accountNumber,
      }

      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Bancolombia conectado</title>
          </head>
          <body>
            <script>
              (function() {
                const payload = ${JSON.stringify(payload)};
                const targetOrigin = ${JSON.stringify(new URL(result.frontendUrl).origin)};
                if (window.opener) {
                  window.opener.postMessage(payload, targetOrigin);
                  window.close();
                  return;
                }
                document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem">Bancolombia se conecto correctamente. Ya puedes cerrar esta ventana.</p>';
              })();
            </script>
          </body>
        </html>
      `)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'oauth_error'
      const safeMessage = escapeForHtml(message)

      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Error de Bancolombia</title>
          </head>
          <body>
            <script>
              (function() {
                const payload = ${JSON.stringify({ type: 'bancolombia-error', message })};
                if (window.opener) {
                  window.opener.postMessage(payload, '*');
                  window.close();
                  return;
                }
                document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem;color:#b91c1c">Error: ${safeMessage}</p>';
              })();
            </script>
          </body>
        </html>
      `)
    }
  }

  @Delete('disconnect')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  disconnect(@TenantId() tenantId: string) {
    return this.bancolombiaService.disconnect(tenantId)
  }

  @Post('sync')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  sync(@TenantId() tenantId: string, @Body() body: BancolombiaSyncDto): Promise<BancolombiaSyncResponse> {
    return this.bancolombiaService.sync(tenantId, body)
  }
}
