import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'
import { PrismaService } from '../database/prisma.service'

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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
        connectionTimeout: 5000,
        socketTimeout: 5000,
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

  // ── Transactional Emails ───────────────────────────────────────────

  async sendOnboardingWelcomeEmail(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        memberships: {
          include: { user: { select: { email: true, name: true } } },
        },
      },
    })
    if (!tenant) return

    const admin = tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user
    if (!admin?.email) return

    const subject = `¡Bienvenido a Contex360, ${tenant.name}!`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #18181B; font-size: 24px; margin: 0;">¡Bienvenido a Contex360!</h1>
          <p style="color: #71717A; font-size: 14px; margin-top: 8px;">Tu empresa <strong>${tenant.name}</strong> está lista</p>
        </div>
        <div style="background: #F4F4F5; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="color: #18181B; font-size: 16px; margin: 0 0 12px 0;">Próximos pasos:</h3>
          <ol style="color: #71717A; font-size: 14px; line-height: 1.8; padding-left: 20px;">
            <li>Configura tu integración DIAN para facturación electrónica</li>
            <li>Crea tu primer producto o servicio</li>
            <li>Invita a tu equipo de trabajo</li>
            <li>Explora el dashboard y módulos disponibles</li>
          </ol>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="display: inline-block; padding: 14px 28px; background: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
            Ir al Dashboard
          </a>
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; border-top: 1px solid #E4E4E7; padding-top: 16px;">
          Si tienes dudas, responde a este correo o visita nuestro centro de ayuda.<br/>
          &copy; 2026 Contex360
        </p>
      </div>`

    await this.sendHtmlEmail(admin.email, subject, html)
    this.logger.log(`Onboarding welcome email sent to ${admin.email} for tenant ${tenantId}`)
  }

  async sendPaymentConfirmationEmail(tenantId: string, payment: any): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        memberships: {
          include: { user: { select: { email: true, name: true } } },
        },
      },
    })
    if (!tenant) return

    const admin = tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user
    if (!admin?.email) return

    const subject = `Pago confirmado — ${payment.planType} (${payment.billing})`
    const amountFormatted = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(payment.amount)
    const dateFormatted = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('es-CO')

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 64px; height: 64px; background: #D1FAE5; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            <span style="font-size: 32px;">✅</span>
          </div>
          <h1 style="color: #18181B; font-size: 22px; margin: 0;">¡Pago confirmado!</h1>
          <p style="color: #71717A; font-size: 14px; margin-top: 4px;">${dateFormatted}</p>
        </div>
        <div style="background: #F4F4F5; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <h3 style="color: #18181B; font-size: 14px; margin: 0 0 12px 0;">Detalles del pago</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr><td style="color: #71717A; padding: 4px 0;">Plan</td><td style="text-align: right; font-weight: 600;">${payment.planType}</td></tr>
            <tr><td style="color: #71717A; padding: 4px 0;">Ciclo</td><td style="text-align: right; font-weight: 600;">${payment.billing === 'annual' ? 'Anual' : 'Mensual'}</td></tr>
            <tr><td style="color: #71717A; padding: 4px 0;">Monto</td><td style="text-align: right; font-weight: 600; font-size: 16px; color: #059669;">${amountFormatted}</td></tr>
            <tr><td style="color: #71717A; padding: 4px 0;">Método</td><td style="text-align: right; font-weight: 600; text-transform: capitalize;">${payment.paymentMethod || 'Tarjeta'}</td></tr>
          </table>
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; border-top: 1px solid #E4E4E7; padding-top: 16px;">
          Recibirás la factura electrónica en este correo.<br/>
          &copy; 2026 Contex360
        </p>
      </div>`

    await this.sendHtmlEmail(admin.email, subject, html)
    this.logger.log(`Payment confirmation sent to ${admin.email} for tenant ${tenantId}`)
  }

  async sendRenewalReminderEmail(tenantId: string, daysUntilRenewal: number): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        memberships: {
          include: { user: { select: { email: true, name: true } } },
        },
      },
    })
    if (!tenant) return

    const admin = tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user
    if (!admin?.email) return

    const subject = `Tu suscripción Contex360 se renueva en ${daysUntilRenewal} días`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #18181B; font-size: 22px; margin: 0;">Recordatorio de renovación</h1>
          <p style="color: #71717A; font-size: 14px; margin-top: 4px;">${tenant.name}</p>
        </div>
        <div style="background: #FEF3C7; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #FDE68A;">
          <p style="color: #92400E; font-size: 14px; margin: 0; text-align: center;">
            Tu suscripción se renovará automáticamente en <strong>${daysUntilRenewal} días</strong>.
          </p>
        </div>
        <p style="color: #71717A; font-size: 14px; line-height: 1.6;">
          Para evitar interrupciones en el servicio, asegúrate de que tu método de pago esté actualizado.
          Puedes revisar y actualizar tu información de facturación desde el panel de administración.
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription" style="display: inline-block; padding: 14px 28px; background: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
            Gestionar suscripción
          </a>
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; border-top: 1px solid #E4E4E7; padding-top: 16px;">
          &copy; 2026 Contex360
        </p>
      </div>`

    await this.sendHtmlEmail(admin.email, subject, html)
    this.logger.log(`Renewal reminder sent to ${admin.email} for tenant ${tenantId} (${daysUntilRenewal} days)`)
  }

  async sendPaymentFailedEmail(tenantId: string, payment: any): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        memberships: {
          include: { user: { select: { email: true, name: true } } },
        },
      },
    })
    if (!tenant) return

    const admin = tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user
    if (!admin?.email) return

    const amountFormatted = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(payment.amount || 0)
    const subject = `⚠️ Pago fallido — ${tenant.name}`

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 64px; height: 64px; background: #FEE2E2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            <span style="font-size: 32px;">⚠️</span>
          </div>
          <h1 style="color: #DC2626; font-size: 22px; margin: 0;">Pago no procesado</h1>
          <p style="color: #71717A; font-size: 14px; margin-top: 4px;">${tenant.name}</p>
        </div>
        <div style="background: #FEF2F2; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #FECACA;">
          <p style="color: #991B1B; font-size: 14px; margin: 0 0 12px 0;">
            No pudimos procesar el pago de tu suscripción por <strong>${amountFormatted}</strong>.
          </p>
          <p style="color: #991B1B; font-size: 14px; margin: 0;">
            Para evitar la suspensión del servicio, actualiza tu método de pago o intenta nuevamente.
          </p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription" style="display: inline-block; padding: 14px 28px; background: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
            Actualizar método de pago
          </a>
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; border-top: 1px solid #E4E4E7; padding-top: 16px;">
          &copy; 2026 Contex360
        </p>
      </div>`

    await this.sendHtmlEmail(admin.email, subject, html)
    this.logger.log(`Payment failed email sent to ${admin.email} for tenant ${tenantId}`)
  }

  async sendSubscriptionExpiredEmail(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        memberships: {
          include: { user: { select: { email: true, name: true } } },
        },
      },
    })
    if (!tenant) return

    const admin = tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user
    if (!admin?.email) return

    const subject = `Tu suscripción Contex360 ha expirado`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="width: 64px; height: 64px; background: #FEE2E2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
            <span style="font-size: 32px;">🔒</span>
          </div>
          <h1 style="color: #DC2626; font-size: 22px; margin: 0;">Suscripción expirada</h1>
          <p style="color: #71717A; font-size: 14px; margin-top: 4px;">${tenant.name}</p>
        </div>
        <div style="background: #FEF2F2; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #FECACA;">
          <p style="color: #991B1B; font-size: 14px; margin: 0;">
            Tu suscripción ha expirado. Algunas funcionalidades pueden estar limitadas.
            Para recuperar el acceso completo, renueva tu plan desde el panel de administración.
          </p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/pricing" style="display: inline-block; padding: 14px 28px; background: #2563EB; color: white; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px;">
            Renovar plan
          </a>
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; border-top: 1px solid #E4E4E7; padding-top: 16px;">
          &copy; 2026 Contex360
        </p>
      </div>`

    await this.sendHtmlEmail(admin.email, subject, html)
    this.logger.log(`Subscription expired email sent to ${admin.email} for tenant ${tenantId}`)
  }

  private async sendHtmlEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Email not sent (no transporter): ${subject} -> ${to}`)
      return
    }
    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'
    try {
      await this.transporter.sendMail({ from: `"Contex360" <${from}>`, to, subject, html })
    } catch (err) {
      this.logger.error(`Error sending email to ${to}: ${subject}: ${safeLogFragment(err)}`)
    }
  }

  private buildWelcomeEmailHtml(data: {
    email: string;
    name: string;
    tempPassword: string;
    companyName: string;
    prefix: string;
  }): string {
    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

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
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${data.token}`

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

  async sendSecurityAlert(to: string, name: string, subject: string, bodyHtml: string): Promise<void> {
    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#f8fafc;color:#1e293b;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#2563eb;margin:0;">Contex360</h1>
      <p style="color:#64748b;font-size:14px;">Notificación de seguridad</p>
    </div>
    <h2 style="color:#1e293b;margin-top:0;">Hola, ${name}</h2>
    ${bodyHtml}
    <hr style="border:0;border-top:1px solid #e2e8f0;margin:32px 0;" />
    <p style="color:#94a3b8;font-size:12px;text-align:center;line-height:1.5;">
      Si no reconoces esta actividad, contacta a nuestro equipo de soporte inmediatamente.<br/>
      &copy; 2026 Contex360 · Sistema de Gestión Financiera
    </p>
  </div>
</body>
</html>`

    if (!this.transporter) {
      this.logger.warn(`SEGURIDAD (sin email): ${subject} | ${safeLogFragment(to)}`)
      return
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@contex360.com'

    await this.transporter.sendMail({ from, to, subject, html }).catch((err) =>
      this.logger.error(`Error enviando alerta de seguridad a ${safeLogFragment(to)}: ${safeLogFragment(err)}`),
    )

    this.logger.log(`Alerta de seguridad enviada a ${safeLogFragment(to)}: ${subject}`)
  }

  buildNewLoginHtml(device: string, browser: string, os: string, ip: string, location: string, time: string): string {
    return `
    <div style="background:#fff7ed;border-radius:8px;padding:20px;border:1px solid #fdba74;margin-bottom:20px;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#9a3412;"><strong>Nuevo inicio de sesión detectado</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#475569;">
        <tr><td style="padding:4px 0;width:100px;">Dispositivo</td><td><strong>${device}</strong></td></tr>
        <tr><td style="padding:4px 0;">Navegador</td><td><strong>${browser}</strong></td></tr>
        <tr><td style="padding:4px 0;">Sistema</td><td><strong>${os}</strong></td></tr>
        <tr><td style="padding:4px 0;">Dirección IP</td><td><strong>${ip}</strong></td></tr>
        <tr><td style="padding:4px 0;">Ubicación</td><td><strong>${location}</strong></td></tr>
        <tr><td style="padding:4px 0;">Fecha/Hora</td><td><strong>${time}</strong></td></tr>
      </table>
    </div>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Si fuiste tú, no necesitas hacer nada. Si no reconoces esta actividad, cambia tu contraseña inmediatamente y contacta a soporte.</p>`
  }

  buildPasswordChangedHtml(time: string, ip: string): string {
    return `
    <div style="background:#f0fdf4;border-radius:8px;padding:20px;border:1px solid #86efac;margin-bottom:20px;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#166534;"><strong>Contraseña actualizada</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#475569;">
        <tr><td style="padding:4px 0;width:100px;">Fecha/Hora</td><td><strong>${time}</strong></td></tr>
        <tr><td style="padding:4px 0;">Dirección IP</td><td><strong>${ip}</strong></td></tr>
      </table>
    </div>
    <p style="color:#475569;font-size:15px;line-height:1.6;">La contraseña de tu cuenta ha sido cambiada exitosamente. Si realizaste este cambio, no necesitas hacer nada más.</p>
    <div style="background:#fff7ed;border-radius:8px;padding:16px;border:1px solid #fdba74;margin-top:16px;">
      <p style="margin:0;font-size:14px;color:#9a3412;"><strong>¿No solicitaste este cambio?</strong> Contacta a soporte inmediatamente para asegurar tu cuenta.</p>
    </div>`
  }

  buildFailedLoginHtml(attempts: number, ip: string, time: string, locked: boolean): string {
    const lockoutWarning = locked
      ? `<div style="background:#fef2f2;border-radius:8px;padding:16px;border:1px solid #fca5a5;margin-top:16px;">
          <p style="margin:0;font-size:14px;color:#991b1b;"><strong>Cuenta bloqueada temporalmente</strong> por superar el límite de intentos permitidos. Intenta de nuevo más tarde.</p>
        </div>`
      : ''

    return `
    <div style="background:#fef2f2;border-radius:8px;padding:20px;border:1px solid #fca5a5;margin-bottom:20px;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#991b1b;"><strong>Intento de inicio de sesión fallido</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#475569;">
        <tr><td style="padding:4px 0;width:100px;">Intentos fallidos</td><td><strong>${attempts}</strong></td></tr>
        <tr><td style="padding:4px 0;">Dirección IP</td><td><strong>${ip}</strong></td></tr>
        <tr><td style="padding:4px 0;">Fecha/Hora</td><td><strong>${time}</strong></td></tr>
      </table>
    </div>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Alguien intentó iniciar sesión en tu cuenta con una contraseña incorrecta. Si fuiste tú, verifica que estás usando la contraseña correcta.</p>
    ${lockoutWarning}`
  }

  buildRoleChangedHtml(previousRole: string, newRole: string, changedBy: string, time: string): string {
    return `
    <div style="background:#f0fdf4;border-radius:8px;padding:20px;border:1px solid #86efac;margin-bottom:20px;">
      <p style="margin:0 0 12px 0;font-size:14px;color:#166534;"><strong>Rol de usuario actualizado</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#475569;">
        <tr><td style="padding:4px 0;width:120px;">Rol anterior</td><td><strong>${previousRole}</strong></td></tr>
        <tr><td style="padding:4px 0;">Rol nuevo</td><td><strong>${newRole}</strong></td></tr>
        <tr><td style="padding:4px 0;">Modificado por</td><td><strong>${changedBy}</strong></td></tr>
        <tr><td style="padding:4px 0;">Fecha/Hora</td><td><strong>${time}</strong></td></tr>
      </table>
    </div>
    <p style="color:#475569;font-size:15px;line-height:1.6;">Los permisos de tu cuenta han sido actualizados. Algunas funcionalidades pueden haber cambiado.</p>`
  }
}
