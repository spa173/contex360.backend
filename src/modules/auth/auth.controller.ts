import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { AuthGuard } from './auth.guard'
import { AuthenticatedRequest, LoginRequestDto } from './auth.types'
import { AuthService } from './auth.service'

function resolveRequestContext(request: AuthenticatedRequest) {
  const forwardedFor = request.headers['x-forwarded-for']
  const userAgent = request.headers['user-agent']

  return {
    ip:
      (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor) ||
      request.ip ||
      request.socket?.remoteAddress ||
      '127.0.0.1',
    userAgent: Array.isArray(userAgent) ? userAgent[0] || '' : userAgent || '',
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginRequestDto, @Req() request: AuthenticatedRequest) {
    return this.authService.login(body, resolveRequestContext(request))
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
  @Post('logout')
  logout(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    return this.authService.logout(request.authUser)
  }
}
