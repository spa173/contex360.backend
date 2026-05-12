export const AUTH_COOKIE_NAME = 'contex360-auth-token'

export const SUPPORTED_OAUTH_PROVIDERS = ['google'] as const

export type OAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number]

export function isOAuthProvider(value: string): value is OAuthProvider {
  return (SUPPORTED_OAUTH_PROVIDERS as readonly string[]).includes(value)
}
