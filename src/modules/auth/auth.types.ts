import { UserStatus } from '@prisma/client'
import { Transform } from 'class-transformer'
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'
import { OAuthProvider } from './auth.constants'

export class LoginRequestDto {
  @Transform(({ value }) => String(value || '').trim().toLowerCase())
  @IsEmail({}, { message: 'El formato del email es invalido.' })
  email!: string

  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'La contrasena debe ser un texto.' })
  @MinLength(1, { message: 'La contrasena es requerida.' })
  password!: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  totpCode?: string
}

export interface TotpRequiredResponse {
  ok: false
  requiresTotp: true
  message: string
}

export interface PasswordExpiredResponse {
  ok: false
  requiresPasswordChange: true
  message: string
}

export class ChangePasswordDto {
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  currentPassword!: string

  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  @MinLength(8, { message: 'La nueva contrasena debe tener al menos 8 caracteres.' })
  newPassword!: string
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  name?: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  title?: string
}

export interface AuthRequestContext {
  ip: string
  userAgent: string
}

export interface AuthTokenPayload {
  sub: string
  sessionId: string
  tenantId: string
  email: string
  isSystemOwner: boolean
}

export interface AuthenticatedRequest {
  authUser?: AuthTokenPayload
  headers: {
    authorization?: string | string[]
    cookie?: string | string[]
    'user-agent'?: string | string[]
    'x-forwarded-for'?: string | string[]
  }
  ip?: string
  socket?: {
    remoteAddress?: string | null
  }
}

export interface PublicTenantSnapshot {
  id: string
  name: string
  prefix: string
  sector: string | null
  city: string | null
  allowNegativeStock: boolean
  costMethod: string | null
  dianStatus: string | null
}

export interface PublicUserSnapshot {
  id: string
  name: string
  email: string
  title: string
  status: UserStatus
  lastLoginAt: string | null
  isSystemOwner: boolean
  isDemoAccount: boolean
}

export interface PublicSessionSnapshot {
  id: string
  userId: string
  tenantId: string
  ip: string
  location: string
  device: string
  browser: string
  os: string
  fingerprint: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  revokedBy: string | null
}

export interface AuthMembershipSnapshot {
  tenantId: string
  role: string
  permissions: string[]
  accessibleViews: string[]
  access: Record<string, string[]>
}

export interface AuthResponseSnapshot {
  ok: true
  message: string
  accessToken: string
  refreshToken: string
  user: PublicUserSnapshot
  session: PublicSessionSnapshot
  activeTenantId: string
  accessibleTenants: PublicTenantSnapshot[]
  memberships: AuthMembershipSnapshot[]
}

export class RefreshTokenDto {
  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'El refresh token es requerido.' })
  @MinLength(1, { message: 'El refresh token es requerido.' })
  refreshToken!: string
}

export interface OAuthStatePayload {
  provider: OAuthProvider
  redirectTo: string
  nonce: string
}

export interface OAuthLoginResult {
  auth: AuthResponseSnapshot
  redirectTo: string
  provider: OAuthProvider
  profile: {
    provider: OAuthProvider
    providerAccountId: string
    email: string
    name: string
    picture: string | null
  }
}
