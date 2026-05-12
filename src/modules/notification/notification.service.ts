import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'

export interface BreachAlertPayload {
  eventId: string
  severity: string
  entity: string
  action: string
  description: string
  actor: string
  occurredAt: Date
  adminEmails: string[]
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)
  private transporter: nodemailer.Transporter | null = null

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST')
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      })
    } else {
      this.logger.warn('SMTP no configurado. Las notificaciones de brecha solo se registraran en logs.')
    }
  }

  async sendBreachAlert(payload: BreachAlertPayload): Promise<void> {
    const subject = `[Contex360] Alerta de seguridad — ${payload.severity.toUpperCase()}: ${payload.action}`
    const html = this.buildBreachAlertHtml(payload)

    if (!this.transporter) {
      this.logger.warn(`BREACH ALERT (sin email): ${subject} | ${payload.description}`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await Promise.all(
      payload.adminEmails.map((to) =>
        this.transporter!.sendMail({ from, to, subject, html }).catch((err) =>
          this.logger.error(`Error enviando alerta a ${to}: ${err.message}`),
        ),
      ),
    )

    this.logger.log(`Alerta de brecha enviada a ${payload.adminEmails.length} administrador(es).`)
  }

  private buildBreachAlertHtml(payload: BreachAlertPayload): string {
    const severityColor = payload.severity === 'critical' ? '#dc2626' : '#ea580c'
    const date = new Date(payload.occurredAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })

    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:12px;padding:28px;border:1px solid ${severityColor};">
    <h2 style="color:${severityColor};margin-top:0;">⚠ Alerta de seguridad — ${payload.severity.toUpperCase()}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#94a3b8;">Acción</td><td><strong>${payload.action}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#94a3b8;">Entidad</td><td>${payload.entity}</td></tr>
      <tr><td style="padding:6px 0;color:#94a3b8;">Actor</td><td>${payload.actor}</td></tr>
      <tr><td style="padding:6px 0;color:#94a3b8;">Fecha</td><td>${date}</td></tr>
      <tr><td style="padding:6px 0;color:#94a3b8;">Descripción</td><td>${payload.description}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#64748b;">
      Este mensaje fue generado automáticamente por Contex360. Revisa la Consola Admin → Logs de Auditoría para más detalles.<br/>
      Conforme a la Ley 1581 de 2012, las brechas de datos personales deben notificarse a la SIC dentro de las 72 horas.
    </p>
  </div>
</body>
</html>`
  }
}
