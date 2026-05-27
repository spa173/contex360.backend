import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import { CSRF_COOKIE_NAME, AUTH_COOKIE_NAME } from '../../modules/auth/auth.constants'
import * as crypto from 'node:crypto'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, ...v] = part.split('=')
    const key = k?.trim()
    if (key) acc[key] = v.join('=').trim()
    return acc
  }, {})
}

function requestUsesOnlyCookieAuth(req: Request): boolean {
  // Si el request tiene Authorization: Bearer <token>, no necesita CSRF
  // porque los headers personalizados no pueden ser enviados cross-origin sin CORS preflight
  const auth = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization
  return !auth?.startsWith('Bearer ')
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const cookies = parseCookies(req.headers.cookie as string | undefined)

    // Emitir token CSRF si hay sesión de cookie y aún no existe
    const hasCookieSession = !!cookies[AUTH_COOKIE_NAME]
    if (hasCookieSession && !cookies[CSRF_COOKIE_NAME]) {
      const token = crypto.randomBytes(32).toString('hex')
      // SameSite=Strict, NO httpOnly → el frontend puede leerla con document.cookie
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      })
      cookies[CSRF_COOKIE_NAME] = token
    }

    // Validar en requests mutantes que usan cookie auth
    if (!SAFE_METHODS.has(req.method) && requestUsesOnlyCookieAuth(req)) {
      // Validate trusted Origin to support Cross-Origin SPAs (Vercel -> Railway)
      const origin = req.headers.origin || ''
      const corsOriginRaw = process.env.CORS_ORIGIN || ''
      const allowedOrigins = corsOriginRaw.split(',').map(o => o.trim())
      
      const isVercelPreview = origin.endsWith('.vercel.app')

      if (isVercelPreview || allowedOrigins.includes(origin)) {
        return next()
      }

      const cookieCsrf = cookies[CSRF_COOKIE_NAME]

      if (!cookieCsrf) {
        // Sin sesión de cookie activa → el Bearer guard se encargará
        return next()
      }

      const headerCsrf = Array.isArray(req.headers['x-csrf-token'])
        ? req.headers['x-csrf-token'][0]
        : req.headers['x-csrf-token']

      if (!headerCsrf || headerCsrf !== cookieCsrf) {
        throw new ForbiddenException('Token CSRF inválido o ausente.')
      }
    }

    next()
  }
}
