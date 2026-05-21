import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Prisma, TransactionCategory, TransactionType } from '@prisma/client'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { PrismaService } from '../database/prisma.service'
import { TreasuryService } from '../treasury/treasury.service'
import {
  BancolombiaAccountType,
  BancolombiaAuthorizationStatus,
  BancolombiaConfigDto,
  BancolombiaEnvironment,
  BancolombiaIntegrationMode,
  BancolombiaStatementEntryInput,
  BancolombiaStatementFileInput,
  BancolombiaStatementFormat,
  BancolombiaSyncDto,
} from './bancolombia.types'

interface BancolombiaOAuthState {
  tenantId: string
  userId: string
  frontendUrl: string
  integrationMode: BancolombiaIntegrationMode
}

export interface BancolombiaStoredMetadata {
  integrationMode: BancolombiaIntegrationMode
  environment: BancolombiaEnvironment
  accountNumber: string
  accountType: BancolombiaAccountType
  clientId: string
  statementFormat: BancolombiaStatementFormat
  authorizationStatus: BancolombiaAuthorizationStatus
  lastSyncAt: string | null
  statementSourceUrl?: string
  consentReceivedAt?: string | null
  connectedAt?: string | null
  lastUpdatedByUserId?: string | null
  consentByUserId?: string | null
  lastSyncSummary?: string | null
}

export interface BancolombiaConfigSnapshot {
  integrationMode: BancolombiaIntegrationMode
  environment: BancolombiaEnvironment
  accountNumber: string
  accountType: BancolombiaAccountType
  clientId: string
  statementFormat: BancolombiaStatementFormat
  authorizationStatus: BancolombiaAuthorizationStatus
  lastSyncAt: string | null
  statementSourceUrl?: string
}

export interface BancolombiaUpdateResponse {
  ok: boolean
  data: BancolombiaConfigSnapshot
  connectUrl?: string | null
  needsConsent?: boolean
  message?: string
}

export interface BancolombiaSyncResponse {
  ok: boolean
  lastSyncAt: string
  message: string
  imported: number
  skipped: number
}

interface BancolombiaTokenResponse {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface BancolombiaImportedStatementEntry {
  date: string
  description: string
  amount: number
  type: TransactionType
  reference: string
}

type ParsedBancolombiaStatement = {
  entries: BancolombiaStatementEntryInput[]
  format: BancolombiaStatementFormat | 'UNKNOWN'
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, '')
}

function isProduction() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
}

function isPrivateIpAddress(hostname: string) {
  const version = isIP(hostname)
  if (!version) {
    return false
  }

  const normalized = hostname.toLowerCase()
  if (version === 6) {
    return normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')
  }

  const [first = NaN, second = NaN] = normalized.split('.').map((part) => Number(part))
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31)
}

function assertSafeExternalUrl(url: string) {
  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Protocolo no permitido para ${hostname}.`)
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIpAddress(hostname)) {
    if (isProduction()) {
      throw new Error(`Destino privado no permitido para ${hostname}.`)
    }
  }

  return parsed.toString()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeJsonParse(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function deriveKey(secret: string) {
  return createHash('sha256').update(secret).digest()
}

function getEncryptionSecret(config: ConfigService) {
  return normalizeText(config.get<string>('BANCOLOMBIA_TOKEN_ENCRYPTION_SECRET') || config.get<string>('JWT_SECRET'))
}

function encryptValue(value: string, secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function decryptValue(value: string, secret: string) {
  if (!value.startsWith('enc:v1:')) {
    return value
  }

  const [, , ivB64, tagB64, dataB64] = value.split(':')
  if (!ivB64 || !tagB64 || !dataB64) {
    return ''
  }

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function encryptSecret(value: string | null | undefined, secret: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  return encryptValue(trimmed, secret)
}

function decryptSecret(value: string | null | undefined, secret: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ''
  try {
    return decryptValue(trimmed, secret)
  } catch {
    return trimmed
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(assertSafeExternalUrl(url), init)
  const text = await response.text()
  const body = text
    ? (() => {
        try {
          return JSON.parse(text) as T
        } catch {
          return { message: text } as T
        }
      })()
    : ({} as T)

  if (!response.ok) {
    const errorBody = body as { error?: string; error_description?: string; message?: string }
    const message =
      errorBody.error_description ||
      errorBody.error ||
      errorBody.message ||
      `Bancolombia HTTP ${response.status}`
    throw new Error(message)
  }

  return body
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue
}

function decodePossibleBase64(value: string) {
  const trimmed = normalizeText(value)
  if (!trimmed) return ''

  try {
    const normalized = trimmed.replace(/\s+/g, '')
    const decoded = Buffer.from(normalized, 'base64').toString('utf8')
    return decoded.trim() || trimmed
  } catch {
    return trimmed
  }
}

function inferStatementFormat(file?: BancolombiaStatementFileInput, text?: string): BancolombiaStatementFormat | 'UNKNOWN' {
  const name = normalizeText(file?.fileName).toLowerCase()
  const contentType = normalizeText(file?.contentType).toLowerCase()
  const sample = normalizeText(text).slice(0, 200).toUpperCase()

  if (file?.format) {
    return file.format
  }

  if (name.endsWith('.camt053') || name.endsWith('.xml') || contentType.includes('xml') || sample.includes('<BKTOCREDT')) {
    return 'CAMT053'
  }

  if (name.endsWith('.mt940') || name.endsWith('.sta') || contentType.includes('text') || sample.includes(':61:')) {
    return 'MT940'
  }

  return 'UNKNOWN'
}

function parseAmount(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, '').replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseIsoDateFromMt940(value: string) {
  const raw = normalizeText(value)
  if (!/^\d{6}$/.test(raw)) return null

  const year = Number(raw.slice(0, 2))
  const month = Number(raw.slice(2, 4)) - 1
  const day = Number(raw.slice(4, 6))
  const fullYear = year >= 70 ? 1900 + year : 2000 + year
  const date = new Date(Date.UTC(fullYear, month, day))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function extractXmlTag(xml: string, tag: string) {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:[^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, 'i')
  const match = xml.match(pattern)
  return match?.[1]?.trim() || ''
}

function extractXmlTagValue(xml: string, tag: string) {
  const value = extractXmlTag(xml, tag)
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractXmlNested(xml: string, outer: string, inner: string) {
  const outerChunk = extractXmlTag(xml, outer)
  if (!outerChunk) return ''
  return extractXmlTagValue(outerChunk, inner)
}

function extractXmlDate(xml: string) {
  const candidates = [
    extractXmlNested(xml, 'BookgDt', 'Dt'),
    extractXmlNested(xml, 'ValDt', 'Dt'),
    extractXmlNested(xml, 'ReqdExctnDt', 'Dt'),
    extractXmlNested(xml, 'BookgDt', 'DtTm'),
  ].filter(Boolean)

  const raw = candidates[0] || ''
  if (!raw) return null

  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function extractXmlDescription(chunk: string) {
  const info = [
    extractXmlTagValue(chunk, 'AddtlNtryInf'),
    extractXmlNested(chunk, 'RmtInf', 'Ustrd'),
    extractXmlNested(chunk, 'RmtInf', 'Strd'),
    extractXmlTagValue(chunk, 'BkTxCd'),
  ].filter(Boolean)

  return info.join(' | ')
}

function parseMt940Statement(content: string): ParsedBancolombiaStatement {
  const entries: BancolombiaStatementEntryInput[] = []
  const lines = content.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean)
  let currentDescription = ''
  let currentAccount = ''

  for (const line of lines) {
    if (line.startsWith(':25:')) {
      currentAccount = normalizeText(line.slice(4))
      continue
    }

    if (line.startsWith(':86:')) {
      currentDescription = normalizeText(line.slice(4))
      continue
    }

    if (!line.startsWith(':61:')) {
      continue
    }

    const raw = line.slice(4)
    const match = raw.match(/^(\d{6})(\d{4})?([CD])([A-Z]?)([\d.,]+)(.*)$/)
    if (!match) {
      continue
    }

    const [, datePart, _entryDate, dcMark, _fundsCode, amountRaw, rest] = match
    const amount = parseAmount(amountRaw)
    const date = parseIsoDateFromMt940(datePart)

    if (!amount || !date) {
      continue
    }

    const type = dcMark === 'D' ? 'EXPENSE' : 'INCOME'
    const reference = normalizeText(rest).replace(/^N[A-Z0-9]{3}/, '').trim()
    const description = currentDescription || reference || `MT940 ${type}`

    entries.push({
      date,
      description,
      amount,
      type,
      reference: `${currentAccount || 'MT940'}|${date.slice(0, 10)}|${reference || description}|${amount.toFixed(2)}`.slice(0, 190),
    })

    currentDescription = ''
  }

  return { entries, format: 'MT940' }
}

function parseCamt053Statement(content: string): ParsedBancolombiaStatement {
  const entries: BancolombiaStatementEntryInput[] = []
  const entryChunks = content.match(/<(?:[A-Za-z0-9_]+:)?Ntry\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?Ntry>/gi) || []

  for (const chunk of entryChunks) {
    const amount = parseAmount(extractXmlTagValue(chunk, 'Amt'))
    if (!amount) continue

    const creditDebit = extractXmlTagValue(chunk, 'CdtDbtInd').toUpperCase()
    const date = extractXmlDate(chunk)
    if (!date) continue

    const reference =
      extractXmlTagValue(chunk, 'AcctSvcrRef') ||
      extractXmlTagValue(chunk, 'NtryRef') ||
      extractXmlTagValue(chunk, 'Ref')

    const description =
      extractXmlDescription(chunk) ||
      reference ||
      'CAMT.053'

    entries.push({
      date,
      description,
      amount,
      type: creditDebit === 'DBIT' ? 'EXPENSE' : 'INCOME',
      reference: `${reference || description}|${date.slice(0, 10)}|${amount.toFixed(2)}`.slice(0, 190),
    })
  }

  return { entries, format: 'CAMT053' }
}

function parseUploadedStatement(file: BancolombiaStatementFileInput | undefined): ParsedBancolombiaStatement {
  if (!file) {
    return { entries: [], format: 'UNKNOWN' }
  }

  const text = normalizeText(file.text)
  const decoded = text || decodePossibleBase64(file.contentBase64 || '')
  const format = inferStatementFormat(file, decoded)

  if (!decoded) {
    return { entries: [], format }
  }

  if (format === 'CAMT053') {
    return parseCamt053Statement(decoded)
  }

  if (format === 'MT940' || format === 'UNKNOWN') {
    return parseMt940Statement(decoded)
  }

  return { entries: [], format }
}

@Injectable()
export class BancolombiaService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly treasury: TreasuryService,
  ) {}

  private getFrontendUrl() {
    const fallback = this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    return normalizeUrl(fallback)
  }

  private getBackendUrl() {
    const fallback = this.config.get<string>('BACKEND_PUBLIC_URL') || this.config.get<string>('APP_URL') || `http://localhost:${this.config.get<string>('PORT') || '3001'}`
    return normalizeUrl(fallback)
  }

  private getEncryptionSecret() {
    const secret = getEncryptionSecret(this.config)
    if (!secret) {
      throw new Error('Falta BANCOLOMBIA_TOKEN_ENCRYPTION_SECRET o JWT_SECRET.')
    }
    return secret
  }

  private getOAuthConfig(environment: BancolombiaEnvironment = 'production') {
    if (environment === 'sandbox') {
      const backendUrl = this.getBackendUrl()
      return {
        authorizationUrl: `${backendUrl}/integrations/bancolombia/sandbox-authorize`,
        tokenUrl: `${backendUrl}/integrations/bancolombia/sandbox-token`,
        clientId: this.config.get<string>('BANCOLOMBIA_CLIENT_ID') || 'mock-client-id',
        clientSecret: this.config.get<string>('BANCOLOMBIA_CLIENT_SECRET') || 'mock-client-secret',
        scope: this.config.get<string>('BANCOLOMBIA_SCOPE') || 'read:statements',
        redirectUri: `${backendUrl}/integrations/bancolombia/callback`,
      }
    }

    const authorizationUrl = normalizeText(this.config.get<string>('BANCOLOMBIA_AUTHORIZATION_URL'))
    const tokenUrl = normalizeText(this.config.get<string>('BANCOLOMBIA_TOKEN_URL'))
    const clientId = normalizeText(this.config.get<string>('BANCOLOMBIA_CLIENT_ID'))
    const clientSecret = normalizeText(this.config.get<string>('BANCOLOMBIA_CLIENT_SECRET'))
    const scope = normalizeText(this.config.get<string>('BANCOLOMBIA_SCOPE'))
    const redirectUri = normalizeText(
      this.config.get<string>('BANCOLOMBIA_REDIRECT_URI') ||
      `${this.getBackendUrl()}/integrations/bancolombia/callback`,
    )

    const missing = [
      ['BANCOLOMBIA_AUTHORIZATION_URL', authorizationUrl],
      ['BANCOLOMBIA_TOKEN_URL', tokenUrl],
      ['BANCOLOMBIA_CLIENT_ID', clientId],
      ['BANCOLOMBIA_CLIENT_SECRET', clientSecret],
      ['BANCOLOMBIA_SCOPE', scope],
    ].filter(([, value]) => !value).map(([name]) => name)

    if (missing.length) {
      throw new BadRequestException(
        `Faltan variables de entorno de Bancolombia: ${missing.join(', ')}.`,
      )
    }

    return {
      authorizationUrl,
      tokenUrl,
      clientId,
      clientSecret,
      scope,
      redirectUri,
    }
  }

  private async getCredential(tenantId: string) {
    return this.prisma.integrationCredential.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
    })
  }

  private normalizeMetadata(raw: Prisma.JsonValue | null | undefined): BancolombiaStoredMetadata {
    const parsed = isPlainObject(safeJsonParse(raw)) ? (safeJsonParse(raw) as Record<string, unknown>) : {}

    return {
      integrationMode: (parsed.integrationMode as BancolombiaIntegrationMode) || 'open_finance',
      environment: (parsed.environment as BancolombiaEnvironment) || 'sandbox',
      accountNumber: normalizeText(parsed.accountNumber),
      accountType: (parsed.accountType as BancolombiaAccountType) || 'Ahorros',
      clientId: normalizeText(parsed.clientId),
      statementFormat: (parsed.statementFormat as BancolombiaStatementFormat) || 'MT940',
      authorizationStatus: (parsed.authorizationStatus as BancolombiaAuthorizationStatus) || 'draft',
      lastSyncAt: parsed.lastSyncAt ? normalizeText(parsed.lastSyncAt) : null,
      statementSourceUrl: normalizeText(parsed.statementSourceUrl) || undefined,
      consentReceivedAt: parsed.consentReceivedAt ? normalizeText(parsed.consentReceivedAt) : null,
      connectedAt: parsed.connectedAt ? normalizeText(parsed.connectedAt) : null,
      lastUpdatedByUserId: parsed.lastUpdatedByUserId ? normalizeText(parsed.lastUpdatedByUserId) : null,
      consentByUserId: parsed.consentByUserId ? normalizeText(parsed.consentByUserId) : null,
      lastSyncSummary: parsed.lastSyncSummary ? normalizeText(parsed.lastSyncSummary) : null,
    }
  }

  private snapshotFromCredential(credential?: Awaited<ReturnType<typeof this.getCredential>>): BancolombiaConfigSnapshot {
    const metadata = this.normalizeMetadata(credential?.metadata)
    const hasTokens = Boolean(credential?.isActive && credential?.accessToken)

    return {
      integrationMode: metadata.integrationMode,
      environment: metadata.environment,
      accountNumber: metadata.accountNumber,
      accountType: metadata.accountType,
      clientId: metadata.clientId,
      statementFormat: metadata.statementFormat,
      authorizationStatus: metadata.authorizationStatus === 'connected' || hasTokens
        ? 'connected'
        : metadata.authorizationStatus,
      lastSyncAt: metadata.lastSyncAt,
      statementSourceUrl: metadata.statementSourceUrl,
    }
  }

  private buildState(payload: BancolombiaOAuthState) {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: '10m',
    })
  }

  private async persistConfig(tenantId: string, metadata: BancolombiaStoredMetadata, tokens?: { accessToken?: string | null; refreshToken?: string | null; expiresAt?: string | null }) {
    const encryptionSecret = this.getEncryptionSecret()

    return this.prisma.integrationCredential.upsert({
      where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
      update: {
        accountEmail: null,
        accessToken: tokens ? encryptSecret(tokens.accessToken, encryptionSecret) : undefined,
        refreshToken: tokens ? encryptSecret(tokens.refreshToken, encryptionSecret) : undefined,
        expiresAt: tokens?.expiresAt ? new Date(tokens.expiresAt) : undefined,
        isActive: metadata.authorizationStatus === 'connected' || metadata.authorizationStatus === 'ready',
        metadata: asJsonValue(metadata),
      },
      create: {
        tenantId,
        provider: 'bancolombia',
        accountEmail: null,
        accessToken: tokens ? encryptSecret(tokens.accessToken, encryptionSecret) : null,
        refreshToken: tokens ? encryptSecret(tokens.refreshToken, encryptionSecret) : null,
        expiresAt: tokens?.expiresAt ? new Date(tokens.expiresAt) : null,
        isActive: metadata.authorizationStatus === 'connected' || metadata.authorizationStatus === 'ready',
        metadata: asJsonValue(metadata),
      },
    })
  }

  async getConfig(tenantId: string): Promise<BancolombiaConfigSnapshot> {
    const credential = await this.getCredential(tenantId)
    return this.snapshotFromCredential(credential)
  }

  async updateConfig(tenantId: string, userId: string, dto: BancolombiaConfigDto) {
    const current = await this.getCredential(tenantId)
    const currentMetadata = this.normalizeMetadata(current?.metadata)
    const nextMetadata: BancolombiaStoredMetadata = {
      ...currentMetadata,
      integrationMode: dto.integrationMode || currentMetadata.integrationMode || 'open_finance',
      environment: dto.environment || currentMetadata.environment || 'sandbox',
      accountNumber: normalizeText(dto.accountNumber ?? currentMetadata.accountNumber),
      accountType: dto.accountType || currentMetadata.accountType || 'Ahorros',
      clientId: normalizeText(dto.clientId ?? currentMetadata.clientId),
      statementFormat: dto.statementFormat || currentMetadata.statementFormat || 'MT940',
      authorizationStatus: currentMetadata.authorizationStatus === 'connected' ? 'connected' : 'ready',
      lastSyncAt: currentMetadata.lastSyncAt || null,
      statementSourceUrl: normalizeText(dto.statementSourceUrl) || currentMetadata.statementSourceUrl,
      consentReceivedAt: currentMetadata.consentReceivedAt || null,
      connectedAt: currentMetadata.connectedAt || null,
      lastUpdatedByUserId: userId,
      consentByUserId: currentMetadata.consentByUserId || null,
      lastSyncSummary: currentMetadata.lastSyncSummary || null,
    }

    if (!nextMetadata.accountNumber) {
      throw new BadRequestException('El numero de cuenta es obligatorio.')
    }

    if (nextMetadata.integrationMode === 'open_finance' && !nextMetadata.clientId) {
      throw new BadRequestException('El Client ID es obligatorio para Open Finance.')
    }

    const updated = await this.persistConfig(tenantId, nextMetadata, {
      accessToken: current?.accessToken ? decryptSecret(current.accessToken, this.getEncryptionSecret()) : null,
      refreshToken: current?.refreshToken ? decryptSecret(current.refreshToken, this.getEncryptionSecret()) : null,
      expiresAt: current?.expiresAt ? current.expiresAt.toISOString() : null,
    })

    const snapshot = this.snapshotFromCredential(updated)
    const needsConsent = snapshot.integrationMode === 'open_finance' && snapshot.authorizationStatus !== 'connected'

    return {
      ok: true,
      data: snapshot,
      needsConsent,
      message: needsConsent
        ? 'La configuracion quedo lista para completar el consentimiento Bancolombia.'
        : 'La configuracion de Bancolombia fue guardada.',
    } satisfies BancolombiaUpdateResponse
  }

  async startConnect(tenantId: string, userId: string) {
    const credential = await this.getCredential(tenantId)
    const metadata = this.normalizeMetadata(credential?.metadata)

    if (metadata.integrationMode !== 'open_finance') {
      throw new BadRequestException('La conexion OAuth aplica solo para Open Finance.')
    }

    const oauth = this.getOAuthConfig(metadata.environment)
    const state = this.buildState({
      tenantId,
      userId,
      frontendUrl: this.getFrontendUrl(),
      integrationMode: metadata.integrationMode,
    })

    const url = new URL(oauth.authorizationUrl)
    url.searchParams.set('client_id', oauth.clientId)
    url.searchParams.set('redirect_uri', oauth.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', oauth.scope)
    url.searchParams.set('state', state)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')

    return { ok: true, url: url.toString() }
  }

  private async exchangeCodeForToken(code: string, environment: BancolombiaEnvironment = 'production') {
    const oauth = this.getOAuthConfig(environment)
    const basic = Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauth.redirectUri,
    })

    return requestJson<BancolombiaTokenResponse>(oauth.tokenUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    })
  }

  async handleCallback(code: string, state: string) {
    let payload: BancolombiaOAuthState

    try {
      payload = this.jwt.verify<BancolombiaOAuthState>(state, {
        secret: this.config.get<string>('JWT_SECRET'),
      })
    } catch {
      throw new UnauthorizedException('Estado Bancolombia invalido o expirado.')
    }

    if (!code) {
      throw new BadRequestException('No se recibio el codigo de autorizacion Bancolombia.')
    }

    const current = await this.getCredential(payload.tenantId)
    const currentMetadata = this.normalizeMetadata(current?.metadata)

    const tokenSet = await this.exchangeCodeForToken(code, currentMetadata.environment)
    if (!tokenSet.access_token && !tokenSet.refresh_token) {
      throw new BadRequestException('Bancolombia no retorno tokens validos.')
    }

    const nextMetadata: BancolombiaStoredMetadata = {
      ...currentMetadata,
      integrationMode: payload.integrationMode,
      authorizationStatus: 'connected',
      consentReceivedAt: new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      consentByUserId: payload.userId,
      lastSyncAt: currentMetadata.lastSyncAt || null,
      lastSyncSummary: currentMetadata.lastSyncSummary || null,
    }

    await this.persistConfig(payload.tenantId, nextMetadata, {
      accessToken: tokenSet.access_token ?? (current?.accessToken ? decryptSecret(current.accessToken, this.getEncryptionSecret()) : null),
      refreshToken: tokenSet.refresh_token ?? (current?.refreshToken ? decryptSecret(current.refreshToken, this.getEncryptionSecret()) : null),
      expiresAt: tokenSet.expires_in ? new Date(Date.now() + tokenSet.expires_in * 1000).toISOString() : current?.expiresAt?.toISOString() || null,
    })

    return {
      accountNumber: nextMetadata.accountNumber,
      frontendUrl: payload.frontendUrl,
    }
  }

  async disconnect(tenantId: string) {
    const current = await this.getCredential(tenantId)
    const currentMetadata = this.normalizeMetadata(current?.metadata)
    const nextMetadata: BancolombiaStoredMetadata = {
      ...currentMetadata,
      authorizationStatus: 'draft',
      lastSyncSummary: currentMetadata.lastSyncSummary || null,
    }

    await this.prisma.integrationCredential.upsert({
      where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
      update: {
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        isActive: false,
        metadata: asJsonValue(nextMetadata),
      },
      create: {
        tenantId,
        provider: 'bancolombia',
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        isActive: false,
        metadata: asJsonValue(nextMetadata),
      },
    })

    return { ok: true }
  }

  private normalizeEntries(input: unknown): BancolombiaStatementEntryInput[] {
    if (!input) return []

    if (Array.isArray(input)) {
      return input as BancolombiaStatementEntryInput[]
    }

    if (!isPlainObject(input)) {
      return []
    }

    const value = input as BancolombiaSyncDto

    if (Array.isArray(value.entries)) {
      return value.entries
    }

    if (value.statement) {
      if (Array.isArray(value.statement.entries)) return value.statement.entries
      if (Array.isArray(value.statement.movements)) return value.statement.movements
      if (Array.isArray(value.statement.transactions)) return value.statement.transactions
      if (Array.isArray(value.statement.data)) return value.statement.data
    }

    return []
  }

  private toImportedEntry(entry: BancolombiaStatementEntryInput): BancolombiaImportedStatementEntry {
    const description = normalizeText(entry.description) || 'Movimiento Bancolombia'
    const amount = Math.abs(Number(entry.amount || 0))
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Cada movimiento debe incluir un monto valido.')
    }

    const parsedDate = entry.date ? new Date(entry.date) : new Date()
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException('Una fecha de extracto es invalida.')
    }

    const normalizedType = normalizeText(entry.type).toLowerCase()
    const type =
      normalizedType === 'expense' || normalizedType === 'debit' || normalizedType === 'out' || normalizedType === 'salida'
        ? TransactionType.EXPENSE
        : TransactionType.INCOME

    const referenceBase = normalizeText(entry.reference) || `${parsedDate.toISOString().slice(0, 10)}|${description}|${amount.toFixed(2)}`
    const reference = referenceBase.slice(0, 190)

    return {
      date: parsedDate.toISOString(),
      description,
      amount,
      type,
      reference,
    }
  }

  private async importTransactions(tenantId: string, entries: BancolombiaStatementEntryInput[]) {
    let imported = 0
    let skipped = 0

    for (const rawEntry of entries) {
      const entry = this.toImportedEntry(rawEntry)
      const existing = await this.prisma.transaction.findFirst({
        where: {
          tenantId,
          reference: entry.reference,
          category: TransactionCategory.BANCO,
        },
      })

      if (existing) {
        skipped += 1
        continue
      }

      await this.treasury.create(tenantId, {
        type: entry.type,
        amount: entry.amount,
        date: entry.date,
        description: entry.description,
        category: TransactionCategory.BANCO,
        reference: entry.reference,
      })
      imported += 1
    }

    return { imported, skipped }
  }

  async sync(tenantId: string, body?: BancolombiaSyncDto): Promise<BancolombiaSyncResponse> {
    const current = await this.getCredential(tenantId)
    const metadata = this.normalizeMetadata(current?.metadata)
    const now = new Date().toISOString()
    const uploaded = parseUploadedStatement(body?.statementFile)

    if (!current || metadata.authorizationStatus === 'draft') {
      throw new BadRequestException('Bancolombia no esta configurado para este tenant.')
    }

    if (uploaded.entries.length) {
      const result = await this.importTransactions(tenantId, uploaded.entries)
      await this.prisma.integrationCredential.update({
        where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
        data: {
          metadata: asJsonValue({
            ...metadata,
            authorizationStatus: 'connected',
            lastSyncAt: now,
            lastSyncSummary: `Extracto ${uploaded.format} importado desde archivo cargado.`,
          }),
          isActive: true,
        },
      })

      return {
        ok: true,
        lastSyncAt: now,
        message: `Archivo ${uploaded.format === 'UNKNOWN' ? 'de extracto' : uploaded.format} importado correctamente.`,
        imported: result.imported,
        skipped: result.skipped,
      }
    }

    if (metadata.integrationMode === 'open_finance') {
      const note =
        'Bancolombia Open Finance valida titularidad y consentimiento, pero no expone movimientos ni saldos. Para conciliacion automatica debes importar extractos empresariales.'

      await this.prisma.integrationCredential.upsert({
        where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
        update: {
          metadata: {
            ...metadata,
            authorizationStatus: 'connected',
            lastSyncAt: now,
            lastSyncSummary: note,
          } as unknown as Prisma.InputJsonValue,
          isActive: true,
        },
        create: {
          tenantId,
          provider: 'bancolombia',
          isActive: true,
          metadata: {
            ...metadata,
            authorizationStatus: 'connected',
            lastSyncAt: now,
            lastSyncSummary: note,
          } as unknown as Prisma.InputJsonValue,
        },
      })

      return {
        ok: true,
        lastSyncAt: now,
        message: note,
        imported: 0,
        skipped: 0,
      }
    }

    const entries = this.normalizeEntries(body)
    if (!entries.length) {
      const sourceUrl = metadata.statementSourceUrl || normalizeText(this.config.get<string>('BANCOLOMBIA_STATEMENT_SOURCE_URL'))
      if (!sourceUrl) {
        throw new BadRequestException('Para modo extractos debes enviar movimientos en el body o configurar BANCOLOMBIA_STATEMENT_SOURCE_URL.')
      }

      const remote = await requestJson<unknown>(sourceUrl, {
        headers: {
          accept: 'application/json',
        },
      })

      const remoteEntries = this.normalizeEntries(
        remote,
      )

      if (!remoteEntries.length) {
        throw new BadRequestException('La fuente de extractos no retorno movimientos validos.')
      }

      const result = await this.importTransactions(tenantId, remoteEntries)
      await this.prisma.integrationCredential.update({
        where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
        data: {
          metadata: asJsonValue({
            ...metadata,
            authorizationStatus: 'connected',
            lastSyncAt: now,
            lastSyncSummary: `Extractos importados desde ${sourceUrl}.`,
          }),
        },
      })

      return {
        ok: true,
        lastSyncAt: now,
        message: 'Extractos empresariales importados correctamente.',
        imported: result.imported,
        skipped: result.skipped,
      }
    }

    const result = await this.importTransactions(tenantId, entries)
    await this.prisma.integrationCredential.update({
      where: { tenantId_provider: { tenantId, provider: 'bancolombia' } },
      data: {
        metadata: asJsonValue({
          ...metadata,
          authorizationStatus: 'connected',
          lastSyncAt: now,
          lastSyncSummary: `Se importaron ${result.imported} movimientos bancarios.`,
        }),
      },
    })

    return {
      ok: true,
      lastSyncAt: now,
      message: 'Extractos bancarios sincronizados correctamente.',
      imported: result.imported,
      skipped: result.skipped,
    }
  }
}
