import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { IsString, MaxLength, MinLength } from 'class-validator'
import type { CookieOptions, Response } from 'express'
import { AUTH_COOKIE_NAME, AUTH_REFRESH_COOKIE_NAME, isOAuthProvider } from './auth.constants'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { TotpService } from './totp.service'
import { ChangePasswordDto, ForgotPasswordDto, LoginRequestDto, RefreshTokenDto, ResetPasswordDto, UpdateProfileDto } from './auth.types'
import type { AuthenticatedRequest } from './auth.types'
import { getDefaultFrontendCallbackUrl } from './oauth.providers'

class TotpCodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code!: string
}

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

function resolveCookieOptions(rememberMe: boolean = false): CookieOptions {
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

  if (rememberMe) {
    options.maxAge = 30 * 24 * 60 * 60 * 1000 // 30 days
  }

  const domain = String(process.env.AUTH_COOKIE_DOMAIN || '').trim()
  if (domain) {
    options.domain = domain
  }

  return options
}

function setAuthCookie(response: Response, token: string, rememberMe: boolean = false) {
  response.cookie(AUTH_COOKIE_NAME, token, resolveCookieOptions(rememberMe))
}

function clearAuthCookie(response: Response) {
  response.clearCookie(AUTH_COOKIE_NAME, resolveCookieOptions())
}

function setRefreshCookie(response: Response, token: string, rememberMe: boolean = false) {
  response.cookie(AUTH_REFRESH_COOKIE_NAME, token, resolveCookieOptions(rememberMe))
}

function clearRefreshCookie(response: Response) {
  response.clearCookie(AUTH_REFRESH_COOKIE_NAME, resolveCookieOptions())
}

function setAuthCookies(response: Response, accessToken: string, refreshToken: string, rememberMe: boolean = false) {
  setAuthCookie(response, accessToken, rememberMe)
  setRefreshCookie(response, refreshToken, rememberMe)
}

function clearAuthCookies(response: Response) {
  clearAuthCookie(response)
  clearRefreshCookie(response)
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

  @Throttle({ short: { ttl: 60000, limit: 30 } })
  @Post('login')
  async login(
    @Body() body: LoginRequestDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const result = await this.authService.login(body, resolveRequestContext(request))
    if (response && 'accessToken' in result) {
      setAuthCookies(response, result.accessToken, result.refreshToken, body.rememberMe)
    }
    return result
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body.email)
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.token, body.newPassword)
  }

  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @Post('refresh')
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const cookies = parseCookieHeader(request.headers.cookie)
    const refreshToken = body.refreshToken || cookies[AUTH_REFRESH_COOKIE_NAME] || ''
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido.')
    }

    const result = await this.authService.refresh({ refreshToken, rememberMe: body.rememberMe }, resolveRequestContext(request))
    if (response) {
      setAuthCookies(response, result.accessToken, result.refreshToken, body.rememberMe)
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
        setAuthCookies(response, result.auth.accessToken, result.auth.refreshToken)
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
  async totpConfirm(@Req() request: AuthenticatedRequest, @Body() body: TotpCodeDto) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    await this.totpService.confirmTotp(request.authUser.sub, body.code)
    return { ok: true, message: '2FA activado correctamente.' }
  }

  @UseGuards(AuthGuard)
  @Post('totp/disable')
  async totpDisable(@Req() request: AuthenticatedRequest, @Body() body: TotpCodeDto) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    await this.totpService.disableTotp(request.authUser.sub, body.code)
    return { ok: true, message: '2FA desactivado.' }
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  async changePassword(@Req() request: AuthenticatedRequest, @Body() body: ChangePasswordDto) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    return this.authService.changePassword(request.authUser.sub, body)
  }

  @UseGuards(AuthGuard)
  @Patch('profile')
  async updateProfile(@Req() request: AuthenticatedRequest, @Body() body: UpdateProfileDto) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    return this.authService.updateProfile(request.authUser.sub, body)
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
      clearAuthCookies(response)
    }

    return {
      ok: true,
      message: 'Sesion cerrada.',
    }
  }

  @UseGuards(AuthGuard)
  @Post('accept-privacy')
  async acceptPrivacy(@Req() request: AuthenticatedRequest, @Body() body: { version: string }) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    return this.authService.acceptPrivacyPolicy(request.authUser.sub, body.version || 'v1.0')
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('verify-email')
  async verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token)
  }

  @UseGuards(AuthGuard)
  @Post('resend-verification')
  async resendVerification(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) throw new UnauthorizedException('Token de acceso requerido.')
    return this.authService.resendVerificationEmail(request.authUser.sub)
  }
}
