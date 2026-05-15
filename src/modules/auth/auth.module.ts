import { Module, Global } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { type SignOptions } from 'jsonwebtoken'
import { PrismaModule } from '../database/prisma.module'
import { AuthController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { TotpService } from './totp.service'
import { PermissionsGuard } from './permissions.guard'

@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'change-me-in-development',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ?? '8h') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, TotpService, PermissionsGuard],
  exports: [AuthService, JwtModule, AuthGuard, TotpService, PermissionsGuard],
})
export class AuthModule {}
