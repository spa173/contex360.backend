import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { CookieOptions, Response } from 'express'
import { AUTH_COOKIE_NAME, isOAuthProvider } from './auth.constants'
import { AuthGuard } from './auth.guard'
import { AuthenticatedRequest, LoginRequestDto, RefreshTokenDto } from './auth.types'
import { AuthService } from './auth.service'
import { TotpService } from './totp.service'
import { getDefaultFrontendCallbackUrl } from './oauth.providers'

function resolveRequestContext(request?: Partial<AuthenticatedRequest>) {
  const forwardedFor = request?.headers?.['x-forwarded-for']
  const userAgent = request?.headers?.['user-agent']

  return {
    ip:
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
      request?.ip ||
      request?.socket?.remoteAddress ||
      '127.0.0.1',
    userAgent: Array.isArray(userAgent) ? userAgent[0] || '' : userAgent || '',
  }
}

function parseCookieHeader(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header

  if (!value) {
    return {}
  }

  return value.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawKey, ...rawValue] = part.split('=')
    const key = rawKey.trim()

    if (!key) {
      return cookies
    }

    cookies[key] = rawValue.join('=').trim()
    return cookies
  }, {})
}

function extractAuthToken(request: AuthenticatedRequest) {
  const authorization = request.headers.authorization
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization

  const cookies = parseCookieHeader(request.headers.cookie)
  if (cookies[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME]
  }

  if (bearer?.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim()
  }

  return ''
}

function resolveCookieOptions(): CookieOptions {
  const sameSiteValue = String(process.env.AUTH_COOKIE_SAMESITE || '').trim().toLowerCase()
  const sameSite =
    sameSiteValue === 'strict' || sameSiteValue === 'lax' || sameSiteValue === 'none'
      ? sameSiteValue
      : process.env.NODE_ENV === 'production'
        ? 'none'
        : 'lax'

  const secureEnv = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase()
  const secure =
    secureEnv === 'true'
      ? true
      : secureEnv === 'false'
        ? false
        : process.env.NODE_ENV === 'production'

  const options: CookieOptions = {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
  }

  const domain = String(process.env.AUTH_COOKIE_DOMAIN || '').trim()
  if (domain) {
    options.domain = domain
  }

  return options
}

function setAuthCookie(response: Response, token: string) {
  response.cookie(AUTH_COOKIE_NAME, token, resolveCookieOptions())
}

function clearAuthCookie(response: Response) {
  response.clearCookie(AUTH_COOKIE_NAME, resolveCookieOptions())
}

function redirectToFrontend(response: Response, redirectTo: string) {
  response.redirect(redirectTo || getDefaultFrontendCallbackUrl())
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
  ) {}

  @Post('login')
  async login(
    @Body() body: LoginRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const result = await this.authService.login(body, resolveRequestContext(request))
    if (response) {
      setAuthCookie(response, result.accessToken)
    }
    return result
  }

  @Post('refresh')
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const result = await this.authService.refresh(body, resolveRequestContext(request))
    if (response) {
      setAuthCookie(response, result.accessToken)
    }
    return result
  }

  @Get('oauth/:provider')
  async oauthStart(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo?: string,
    @Res() response?: Response,
  ) {
    const fallbackRedirect = getDefaultFrontendCallbackUrl()

    try {
      if (!isOAuthProvider(provider)) {
        throw new BadRequestException('Proveedor OAuth invalido.')
      }

      const authorizationUrl = await this.authService.buildOAuthAuthorizationUrl(provider, redirectTo)
      response?.redirect(authorizationUrl)
    } catch (error) {
      if (response) {
        const message = error instanceof Error ? error.message : 'oauth_error'
        response.redirect(`${fallbackRedirect}?error=${encodeURIComponent(message)}`)
        return
      }

      throw error
    }
  }

  @Get('oauth/:provider/callback')
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Req() request?: AuthenticatedRequest,
    @Res() response?: Response,
  ) {
    const fallbackRedirect = getDefaultFrontendCallbackUrl()

    try {
      if (!isOAuthProvider(provider)) {
        throw new BadRequestException('Proveedor OAuth invalido.')
      }

      const result = await this.authService.completeOAuthLogin(
        provider,
        code || '',
        state || '',
        resolveRequestContext(request),
      )

      if (response) {
        setAuthCookie(response, result.auth.accessToken)
        redirectToFrontend(response, result.redirectTo)
      }
    } catch (error) {
      if (response) {
        clearAuthCookie(response)
        const message = error instanceof Error ? error.message : 'oauth_error'
        response.redirect(`${fallbackRedirect}?error=${encodeURIComponent(message)}`)
      }
    }
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    return this.authService.me(request.authUser)
  }

  @UseGuards(AuthGuard)
  @Get('totp/setup')
  async totpSetup(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    return this.totpService.setupTotp(request.authUser.sub)
  }

  @UseGuards(AuthGuard)
  @Post('totp/confirm')
  async totpConfirm(@Req() request: AuthenticatedRequest, @Body() body: { code: string }) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    await this.totpService.confirmTotp(request.authUser.sub, body.code)
    return { ok: true, message: '2FA activado correctamente.' }
  }

  @UseGuards(AuthGuard)
  @Post('totp/disable')
  async totpDisable(@Req() request: AuthenticatedRequest, @Body() body: { code: string }) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    await this.totpService.disableTotp(request.authUser.sub, body.code)
    return { ok: true, message: '2FA desactivado.' }
  }

  @Post('logout')
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response?: Response) {
    const token = extractAuthToken(request)

    if (token) {
      const authUser = await this.authService.verifyAuthToken(token, true)
      if (authUser) {
        await this.authService.logout(authUser)
      }
    }

    if (response) {
      clearAuthCookie(response)
    }

    return {
      ok: true,
      message: 'Sesion cerrada.',
    }
  }
}
