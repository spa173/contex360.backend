import { Controller, Get, Post, Delete, Query, Body, Res, Req, UseGuards } from '@nestjs/common'
import { Response } from 'express'
import { GmailService } from './gmail.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthenticatedRequest } from '../auth/auth.types'
import { Public } from '../auth/public.decorator'

@Controller('integrations/gmail')
export class GmailController {
  constructor(private readonly gmailService: GmailService) {}

  @Get('connect')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  connect(@TenantId() tenantId: string, @Req() req: AuthenticatedRequest) {
    const url = this.gmailService.getAuthUrl(tenantId, req.authUser!.sub)
    return { ok: true, url }
  }

  @Get('callback')
  @Public()
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      const { email, frontendUrl } = await this.gmailService.handleCallback(code, state)
      // Close the popup and notify the parent window
      return res.send(`
        <!DOCTYPE html><html><head><title>Gmail conectado</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'gmail-connected', email: '${email}' }, '${frontendUrl}');
              window.close();
            } else {
              document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem">✅ Gmail conectado como <strong>${email}</strong>. Puedes cerrar esta ventana.</p>';
            }
          </script>
        </body></html>
      `)
    } catch (e) {
      return res.send(`
        <!DOCTYPE html><html><head><title>Error</title></head>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'gmail-error', message: '${(e as Error).message}' }, '*');
              window.close();
            } else {
              document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem;color:red">❌ Error: ${(e as Error).message}</p>';
            }
          </script>
        </body></html>
      `)
    }
  }

  @Get('status')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  status(@TenantId() tenantId: string) {
    return this.gmailService.getStatus(tenantId)
  }

  @Delete('disconnect')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_admin')
  disconnect(@TenantId() tenantId: string) {
    return this.gmailService.disconnect(tenantId)
  }

  @Post('send')
  @UseGuards(AuthGuard, PermissionsGuard)
  @Permissions('view_billing')
  send(
    @TenantId() tenantId: string,
    @Body() body: { to: string; subject: string; html: string },
  ) {
    return this.gmailService.sendEmail(tenantId, body.to, body.subject, body.html)
  }
}
