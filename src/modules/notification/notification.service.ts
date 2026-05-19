import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'

function safeLogFragment(value: unknown) {
  const message = value instanceof Error
    ? value.message || value.name
    : typeof value === 'string'
      ? value
      : String(value ?? '')

  return message.replace(/[\r\n]+/g, ' ').trim().slice(0, 240)
}

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
      const port = this.config.get<number>('SMTP_PORT') ?? 587
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
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
      this.logger.warn(`BREACH ALERT (sin email): ${safeLogFragment(subject)} | ${safeLogFragment(payload.description)}`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await Promise.all(
      payload.adminEmails.map((to) =>
        this.transporter!.sendMail({ from, to, subject, html }).catch((err) =>
          this.logger.error(`Error enviando alerta a ${safeLogFragment(to)}: ${safeLogFragment(err)}`),
        ),
      ),
    )

    this.logger.log(`Alerta de brecha enviada a ${payload.adminEmails.length} administrador(es).`)
  }

  async sendDemoRequestEmail(data: any, adminEmail: string): Promise<void> {
    const subject = `[Contex360] Nueva solicitud de Demo: ${data.empresa}`
    const html = this.buildDemoRequestHtml(data)

    if (!this.transporter) {
      this.logger.warn(`NUEVA DEMO (sin email): ${safeLogFragment(subject)} | ${safeLogFragment(data.nombre)} (${safeLogFragment(data.correo)})`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await this.transporter.sendMail({ from, to: adminEmail, subject, html }).catch((err) =>
      this.logger.error(`Error enviando notificación de demo a ${safeLogFragment(adminEmail)}: ${safeLogFragment(err)}`),
    )

    this.logger.log(`Notificación de demo enviada a ${safeLogFragment(adminEmail)}.`)
  }

  async sendWelcomeCredentialsEmail(data: {
    email: string;
    name: string;
    tempPassword: string;
    companyName: string;
    prefix: string;
  }): Promise<void> {
    const subject = `¡Bienvenido a Contex360! — Credenciales de acceso para ${data.companyName}`
    const html = this.buildWelcomeEmailHtml(data)

    if (!this.transporter) {
      this.logger.warn(`BIENVENIDA CLIENTE (sin email): ${safeLogFragment(subject)} | ${safeLogFragment(data.email)}`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await this.transporter.sendMail({ from, to: data.email, subject, html }).catch((err) =>
      this.logger.error(`Error enviando credenciales a ${safeLogFragment(data.email)}: ${safeLogFragment(err)}`),
    )

    this.logger.log(`Credenciales de bienvenida enviadas a ${data.email}.`)
  }

  async sendGenericEmail(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`ENVIO EMAIL (sin transporter): ${safeLogFragment(to)} | ${safeLogFragment(subject)}`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'
    const html = `
      <div style="font-family: sans-serif; padding: 24px; color: #1e293b; background: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
          <div style="margin-bottom: 24px; border-bottom: 2px solid #2563eb; padding-bottom: 12px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 24px;">Contex360 Assistant</h1>
          </div>
          <div style="white-space: pre-wrap; line-height: 1.7; font-size: 16px;">${body}</div>
          <hr style="margin: 32px 0; border: none; border-top: 1px solid #e2e8f0;" />
          <p style="font-size: 12px; color: #64748b; text-align: center;">
            Este mensaje fue redactado y enviado por el Asistente Ejecutivo de Contex360 por solicitud de un administrador.<br/>
            &copy; 2026 Contex360 Enterprise Suite
          </p>
        </div>
      </div>
    `

    try {
      await this.transporter.sendMail({ from, to, subject, html })
      this.logger.log(`Email genérico enviado a ${safeLogFragment(to)}.`)
    } catch (err: any) {
      this.logger.error(`Error enviando email genérico a ${safeLogFragment(to)}: ${safeLogFragment(err)}`)
      throw new Error(`No se pudo enviar el correo: ${safeLogFragment(err)}`)
    }
  }

  private buildWelcomeEmailHtml(data: {
    email: string;
    name: string;
    tempPassword: string;
    companyName: string;
    prefix: string;
  }): string {
    const loginUrl = 'https://contex360fronted.vercel.app'

    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#f8fafc;color:#1e293b;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#10b981;margin:0;">Contex360</h1>
      <p style="color:#64748b;font-size:16px;">Plataforma de Gestión Empresarial</p>
    </div>
    
    <h2 style="color:#1e293b;margin-top:0;">¡Hola, ${data.name}!</h2>
    <p style="color:#475569;font-size:16px;line-height:1.6;">
      Es un gusto saludarte. Tu cuenta para <strong>${data.companyName}</strong> ha sido creada exitosamente. 
      Ya puedes acceder a la plataforma utilizando las siguientes credenciales:
    </p>
    
    <div style="background:#f1f5f9;border-radius:8px;padding:24px;margin:24px 0;border:1px solid #e2e8f0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#64748b;width:120px;">URL de acceso</td><td><a href="${loginUrl}" style="color:#10b981;font-weight:600;">${loginUrl}</a></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Usuario</td><td><strong>${data.email}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Contraseña</td><td><code style="background:#ffffff;padding:4px 8px;border-radius:4px;border:1px solid #cbd5e1;font-size:16px;font-weight:700;color:#0f172a;">${data.tempPassword}</code></td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Prefijo ID</td><td><code>${data.prefix}</code></td></tr>
      </table>
    </div>

    <div style="background:#fff7ed;border-radius:8px;padding:16px;border:1px solid #fdba74;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#9a3412;">
        <strong>Nota de seguridad:</strong> Por tu protección, el sistema te solicitará cambiar esta contraseña temporal en tu primer inicio de sesión.
      </p>
    </div>

    <p style="text-align:center;margin-top:32px;">
      <a href="${loginUrl}" style="background:#10b981;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Acceder ahora</a>
    </p>

    <hr style="border:0;border-top:1px solid #e2e8f0;margin:32px 0;" />
    
    <p style="color:#94a3b8;font-size:12px;text-align:center;line-height:1.5;">
      Si no solicitaste esta cuenta, por favor contacta a nuestro equipo de soporte.<br/>
      &copy; 2026 Contex360 · Sistema de Gestión Financiera
    </p>
  </div>
</body>
</html>`
  }

  private buildDemoRequestHtml(data: any): string {
    const date = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })

    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#f8fafc;color:#1e293b;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <h2 style="color:#10b981;margin-top:0;">🚀 Nueva Solicitud de Demo</h2>
    <p style="color:#64748b;font-size:16px;margin-bottom:24px;">Se ha recibido una nueva solicitud de demostración a través del portal de Contex360.</p>
    
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;width:140px;">Empresa</td><td><strong>${data.empresa}</strong></td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">NIT</td><td>${data.nit || 'No proporcionado'}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">Nombre</td><td>${data.nombre}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">Correo</td><td><a href="mailto:${data.correo}" style="color:#10b981;text-decoration:none;">${data.correo}</a></td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">Teléfono</td><td>${data.telefono || 'No proporcionado'}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">Ubicación</td><td>${data.ciudad || ''} ${data.direccion || ''}</td></tr>
      <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:12px 0;color:#64748b;">Sector</td><td>${data.sector || 'No especificado'}</td></tr>
      <tr><td style="padding:12px 0;color:#64748b;">Mensaje</td><td style="padding:12px 0;line-height:1.5;">${data.mensaje || 'Sin mensaje'}</td></tr>
    </table>

    <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:14px;color:#64748b;text-align:center;">
      Recibido el: ${date}
    </div>
    
    <p style="margin-top:24px;text-align:center;">
      <a href="https://contex360fronted.vercel.app" style="background:#10b981;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Ver en Consola Admin</a>
    </p>
  </div>
</body>
</html>`
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
  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const subject = 'Recuperación de contraseña — Contex360'
    const html = this.buildPasswordResetHtml({ email, name, token })

    if (!this.transporter) {
      this.logger.warn(
        `RESET PASSWORD (sin email): ${safeLogFragment(subject)} | ${safeLogFragment(email)} | enlace de recuperacion no enviado`,
      )
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await this.transporter.sendMail({ from, to: email, subject, html }).catch((err) =>
      this.logger.error(`Error enviando correo de reset a ${safeLogFragment(email)}: ${safeLogFragment(err)}`),
    )

    this.logger.log(`Correo de recuperación enviado a ${email}.`)
  }

  private buildPasswordResetHtml(data: { email: string; name: string; token: string }): string {
    const resetUrl = `https://contex360fronted.vercel.app/reset-password?token=${data.token}`

    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#f8fafc;color:#1e293b;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#2563eb;margin:0;">Contex360</h1>
    </div>
    
    <h2 style="color:#1e293b;margin-top:0;">Hola, ${data.name || 'usuario'}</h2>
    <p style="color:#475569;font-size:16px;line-height:1.6;">
      Hemos recibido una solicitud para restablecer la contraseña de tu cuenta asociada al correo <strong>${data.email}</strong>.
    </p>
    
    <p style="text-align:center;margin:32px 0;">
      <a href="${resetUrl}" style="background:#2563eb;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Restablecer contraseña</a>
    </p>

    <div style="background:#fff7ed;border-radius:8px;padding:16px;border:1px solid #fdba74;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#9a3412;">
        <strong>Nota de seguridad:</strong> Este enlace expirará en 15 minutos. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.
      </p>
    </div>

    <hr style="border:0;border-top:1px solid #e2e8f0;margin:32px 0;" />
    
    <p style="color:#94a3b8;font-size:12px;text-align:center;line-height:1.5;">
      Si tienes problemas, copia y pega el siguiente enlace en tu navegador:<br/>
      <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a><br/><br/>
      &copy; 2026 Contex360 · Sistema de Gestión Financiera
    </p>
  </div>
</body>
</html>`
  }
}
