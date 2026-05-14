export const AUTH_COOKIE_NAME = 'contex360-auth-token'
...
export type OAuthProvider = 'google'

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google'
}

