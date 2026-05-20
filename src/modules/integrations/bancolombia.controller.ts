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

  @Get('sandbox-authorize')
  @Public()
  async sandboxAuthorize(
    @Query('redirect_uri') redirectUri: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Bancolombia - Portal de Consentimiento</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f4f4f5;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          .card {
            background: white;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            width: 100%;
            max-width: 440px;
            overflow: hidden;
            border: 1px solid #e4e4e7;
          }
          .header {
            background-color: #FDDA24;
            padding: 24px;
            text-align: center;
            border-bottom: 2px solid #000;
          }
          .logo {
            font-size: 24px;
            font-weight: 800;
            color: #000;
            letter-spacing: -0.5px;
          }
          .content {
            padding: 32px 24px;
          }
          h2 {
            font-size: 18px;
            font-weight: 700;
            color: #18181b;
            margin-top: 0;
            margin-bottom: 12px;
          }
          p {
            font-size: 13px;
            color: #71717a;
            line-height: 1.5;
            margin: 0 0 20px 0;
          }
          .scopes {
            background: #fafafa;
            border: 1px solid #e4e4e7;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
          }
          .scope-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            margin-bottom: 12px;
          }
          .scope-item:last-child {
            margin-bottom: 0;
          }
          .scope-icon {
            color: #16a34a;
            font-weight: bold;
          }
          .scope-text {
            font-size: 12px;
            color: #27272a;
            font-weight: 500;
          }
          .actions {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .btn {
            padding: 12px;
            font-size: 14px;
            font-weight: 600;
            border-radius: 10px;
            border: none;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
            text-decoration: none;
          }
          .btn-primary {
            background-color: #000;
            color: #fff;
          }
          .btn-primary:hover {
            background-color: #27272a;
          }
          .btn-secondary {
            background-color: transparent;
            color: #71717a;
            border: 1px solid #e4e4e7;
          }
          .btn-secondary:hover {
            background-color: #fafafa;
            color: #18181b;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div class="logo">Bancolombia <span style="font-weight:300;font-size:14px;background:#000;color:#fff;padding:2px 6px;border-radius:4px;margin-left:5px;vertical-align:middle;">SANDBOX</span></div>
          </div>
          <div class="content">
            <h2>Autorizar Conexión con Contex360</h2>
            <p>La aplicación <strong>Contex360</strong> solicita acceso a tu cuenta bancaria para realizar conciliación automática de movimientos.</p>
            
            <div class="scopes">
              <div class="scope-item">
                <span class="scope-icon">✓</span>
                <span class="scope-text">Verificar titularidad del producto bancario</span>
              </div>
              <div class="scope-item">
                <span class="scope-icon">✓</span>
                <span class="scope-text">Consultar saldos en tiempo real</span>
              </div>
              <div class="scope-item">
                <span class="scope-icon">✓</span>
                <span class="scope-text">Acceder al histórico de movimientos y extractos</span>
              </div>
            </div>
            
            <div class="actions">
              <a href="${redirectUri}?code=mock-authorization-code&state=${state}" class="btn btn-primary">Autorizar y Conectar</a>
              <a href="${redirectUri}?error=access_denied&state=${state}" class="btn btn-secondary">Cancelar</a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `)
  }

  @Post('sandbox-token')
  @Public()
  async sandboxToken() {
    return {
      access_token: 'mock-access-token-' + Math.random().toString(36).substring(7),
      refresh_token: 'mock-refresh-token-' + Math.random().toString(36).substring(7),
      expires_in: 3600,
      scope: 'read:statements',
    }
  }
}
