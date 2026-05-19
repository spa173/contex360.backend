import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { google } from 'googleapis'
import { PrismaService } from '../database/prisma.service'

interface GmailOAuthState {
  tenantId: string
  userId: string
  frontendUrl: string
}

@Injectable()
export class GmailService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private getOAuth2Client() {
    return new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GMAIL_OAUTH_REDIRECT_URI') ??
        `${this.config.get('BACKEND_PUBLIC_URL')}/integrations/gmail/callback`,
    )
  }

  getAuthUrl(tenantId: string, userId: string): string {
    const client = this.getOAuth2Client()
    const state = this.jwt.sign(
      { tenantId, userId, frontendUrl: this.config.get('FRONTEND_URL') } as GmailOAuthState,
      { expiresIn: '10m', secret: this.config.get('JWT_SECRET') },
    )
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'],
      state,
    })
  }

  async handleCallback(code: string, state: string): Promise<{ email: string; frontendUrl: string }> {
    let payload: GmailOAuthState
    try {
      payload = this.jwt.verify<GmailOAuthState>(state, { secret: this.config.get('JWT_SECRET') })
    } catch {
      throw new UnauthorizedException('Estado OAuth inválido o expirado.')
    }

    const client = this.getOAuth2Client()
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token && !tokens.access_token) {
      throw new BadRequestException('No se recibieron tokens de Google.')
    }

    // Get the authenticated user email
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const { data } = await oauth2.userinfo.get()
    const email = data.email ?? ''

    await this.prisma.integrationCredential.upsert({
      where: { tenantId_provider: { tenantId: payload.tenantId, provider: 'gmail' } },
      update: {
        accountEmail: email,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
      create: {
        tenantId: payload.tenantId,
        provider: 'gmail',
        accountEmail: email,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
    })

    return { email, frontendUrl: payload.frontendUrl }
  }

  async getStatus(tenantId: string) {
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'gmail' } },
    })
    if (!cred || !cred.isActive) return { connected: false, email: null }
    return { connected: true, email: cred.accountEmail }
  }

  async disconnect(tenantId: string) {
    await this.prisma.integrationCredential.updateMany({
      where: { tenantId, provider: 'gmail' },
      data: { isActive: false, accessToken: null, refreshToken: null },
    })
    return { ok: true }
  }

  async sendEmail(tenantId: string, to: string, subject: string, htmlBody: string, attachments?: { filename: string; content: Buffer; contentType: string }[]) {
    const cred = await this.prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'gmail' } },
    })
    if (!cred?.isActive || !cred.refreshToken) {
      throw new BadRequestException('Gmail no está conectado. Conecta tu cuenta primero.')
    }

    const client = this.getOAuth2Client()
    client.setCredentials({
      access_token: cred.accessToken,
      refresh_token: cred.refreshToken,
      expiry_date: cred.expiresAt?.getTime(),
    })

    // Auto-refresh token if needed
    const { credentials } = await client.refreshAccessToken()
    if (credentials.access_token && credentials.access_token !== cred.accessToken) {
      await this.prisma.integrationCredential.update({
        where: { tenantId_provider: { tenantId, provider: 'gmail' } },
        data: {
          accessToken: credentials.access_token,
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        },
      })
      client.setCredentials(credentials)
    }

    const gmail = google.gmail({ version: 'v1', auth: client })

    // Build RFC 2822 raw email with optional attachments
    const boundary = `boundary_${Date.now()}`
    let raw = [
      `From: ${cred.accountEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
    ]

    if (attachments?.length) {
      raw.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
      raw.push('', `--${boundary}`)
      raw.push('Content-Type: text/html; charset="UTF-8"', '', htmlBody)
      for (const att of attachments) {
        raw.push(`--${boundary}`)
        raw.push(`Content-Type: ${att.contentType}`)
        raw.push(`Content-Disposition: attachment; filename="${att.filename}"`)
        raw.push('Content-Transfer-Encoding: base64')
        raw.push('', att.content.toString('base64'))
      }
      raw.push(`--${boundary}--`)
    } else {
      raw.push('Content-Type: text/html; charset="UTF-8"', '', htmlBody)
    }

    const encoded = Buffer.from(raw.join('\r\n')).toString('base64url')
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })
    return { ok: true, sentFrom: cred.accountEmail }
  }
}
