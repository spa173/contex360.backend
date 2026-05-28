import { OAuthProvider } from './auth.constants'

interface OAuthProviderConfig {
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export interface OAuthProfileSnapshot {
  provider: OAuthProvider
  providerAccountId: string
  email: string
  name: string
  picture: string | null
  raw: Record<string, unknown>
}

function env(name: string, fallback = '') {
  const value = String(process.env[name] || '').trim()
  return value || fallback
}

function normalizeUrl(value: string) {
  let url = value
  while (url.endsWith('/')) {
    url = url.slice(0, -1)
  }
  return url
}

const TRUSTED_OAUTH_HOSTS = new Set([
  'accounts.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
])

function isProduction() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
}

export function getDefaultFrontendCallbackUrl() {
  const fallback = isProduction()
    ? 'https://contex360fronted.vercel.app'
    : 'http://localhost:5173'

  return `${normalizeUrl(env('FRONTEND_URL', fallback))}/auth/callback`
}

export function resolveAllowedRedirectTo(redirectTo?: string) {
  const defaultRedirect = getDefaultFrontendCallbackUrl()
  const allowedOrigins = new Set(
    [
      env('FRONTEND_URL'),
      env('FRONTEND_ORIGIN'),
      env('OAUTH_ALLOWED_REDIRECT_ORIGINS'),
      'http://localhost:5173',
      'http://localhost:4173',
      'https://contex360fronted.vercel.app',
    ]
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  )

  if (!redirectTo) {
    return defaultRedirect
  }

  try {
    const parsed = new URL(redirectTo)
    if (!allowedOrigins.has(parsed.origin)) {
      return defaultRedirect
    }

    return parsed.toString()
  } catch {
    return defaultRedirect
  }
}

function resolveBackendBaseUrl() {
  const fallback = isProduction()
    ? 'https://contex360-backend.onrender.com'
    : `http://localhost:${env('PORT', '3001')}`

  return normalizeUrl(env('BACKEND_PUBLIC_URL', fallback))
}

function assertTrustedOAuthUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !TRUSTED_OAUTH_HOSTS.has(parsed.hostname)) {
    throw new Error(`OAuth endpoint no permitido: ${parsed.hostname}`)
  }

  return parsed.toString()
}

function resolveProviderRedirectUri(provider: OAuthProvider) {
  const explicit = env('GOOGLE_OAUTH_REDIRECT_URI')

  if (explicit) {
    return explicit
  }

  return `${resolveBackendBaseUrl()}/auth/oauth/${provider}/callback`
}

function resolveProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
  const clientId = env('GOOGLE_CLIENT_ID')
  const clientSecret = env('GOOGLE_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    throw new Error('Faltan credenciales OAuth de Google.')
  }

  return {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile',
    clientId,
    clientSecret,
    redirectUri: resolveProviderRedirectUri(provider),
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(assertTrustedOAuthUrl(url), init)
  const text = await response.text()
  const body = text ? (() => {
    try {
      return JSON.parse(text) as T
    } catch {
      return { message: text } as T
    }
  })() : ({} as T)

  if (!response.ok) {
    const errorBody = body as { error?: string; error_description?: string; message?: string }
    const message =
      errorBody.error_description ||
      errorBody.error ||
      errorBody.message ||
      `OAuth HTTP ${response.status}`
    throw new Error(message)
  }

  return body
}

export function buildOAuthAuthorizationUrl(provider: OAuthProvider, state: string) {
  const config = resolveProviderConfig(provider)
  const url = new URL(config.authorizationUrl)

  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent select_account')
  url.searchParams.set('include_granted_scopes', 'true')

  return url.toString()
}

export async function exchangeOAuthCodeForToken(provider: OAuthProvider, code: string) {
  const config = resolveProviderConfig(provider)
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  })

  const tokenResponse = await requestJson<OAuthTokenResponse>(config.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!tokenResponse.access_token) {
    throw new Error('OAuth token response did not include an access token.')
  }

  return tokenResponse
}

export async function fetchOAuthProfile(provider: OAuthProvider, accessToken: string) {
  const profile = await requestJson<Record<string, unknown>>(new URL(resolveProviderConfig(provider).userInfoUrl).toString(), {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })

  const emailVal = typeof profile.email === 'string' ? profile.email : ''
  const email = emailVal.trim().toLowerCase()
  const subVal = typeof profile.sub === 'string' ? profile.sub : typeof profile.id === 'string' ? profile.id : ''
  const providerAccountId = subVal.trim()

  if (!providerAccountId || !email) {
    throw new Error('No fue posible obtener el perfil de Google.')
  }

  const nameVal = typeof profile.name === 'string' ? profile.name : typeof profile.given_name === 'string' ? profile.given_name : email
  const name = nameVal.trim() || email

  return {
    provider,
    providerAccountId,
    email,
    name,
    picture: typeof profile.picture === 'string' && profile.picture.trim() ? profile.picture : null,
    raw: profile,
  } satisfies OAuthProfileSnapshot
}
