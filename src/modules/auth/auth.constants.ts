export const AUTH_COOKIE_NAME = 'contex360-auth-token'
export const AUTH_REFRESH_COOKIE_NAME = 'contex360-refresh-token'

export type OAuthProvider = 'google'

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google'
}
