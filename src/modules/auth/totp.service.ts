import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common'
import * as otplib from 'otplib'
import * as QRCode from 'qrcode'
import { PrismaService } from '../database/prisma.service'

const authenticator = (otplib as any).authenticator ?? (otplib as any).default?.authenticator ?? otplib

const APP_NAME = 'Contex360'

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService) {}

  async setupTotp(userId: string): Promise<{ secret: string; qrCodeUrl: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException('Usuario no encontrado.')

    const secret = authenticator.generateSecret()
    const otpauthUrl = authenticator.keyuri(user.email, APP_NAME, secret)
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl)

    await this.prisma.userSecurityProfile.upsert({
      where: { userId },
      update: { totpSecret: secret, twoFactorEnabled: false },
      create: {
        userId,
        totpSecret: secret,
        twoFactorEnabled: false,
        twoFactorRequired: false,
        passwordResetRequired: false,
        passwordHistory: [],
        trustedFingerprints: [],
      },
    })

    return { secret, qrCodeUrl, otpauthUrl }
  }

  async confirmTotp(userId: string, code: string): Promise<void> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } })
    if (!profile?.totpSecret) throw new BadRequestException('TOTP no configurado. Inicia el proceso desde /auth/totp/setup.')

    const isValid = authenticator.verify({ token: code, secret: profile.totpSecret })
    if (!isValid) throw new BadRequestException('Codigo TOTP invalido. Verifica tu app autenticadora.')

    await this.prisma.userSecurityProfile.update({
      where: { userId },
      data: { twoFactorEnabled: true },
    })
  }

  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } })
    if (!profile?.totpSecret || !profile.twoFactorEnabled) return true

    return authenticator.verify({ token: code, secret: profile.totpSecret })
  }

  async disableTotp(userId: string, code: string): Promise<void> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } })
    if (!profile?.totpSecret) throw new BadRequestException('2FA no esta activo.')

    const isValid = authenticator.verify({ token: code, secret: profile.totpSecret })
    if (!isValid) throw new BadRequestException('Codigo TOTP invalido.')

    await this.prisma.userSecurityProfile.update({
      where: { userId },
      data: { twoFactorEnabled: false, totpSecret: null },
    })
  }
}
