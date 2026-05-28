import { Module, Global } from '@nestjs/common'
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino'
import { LoggerService } from './logger.service'

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
          : undefined,
        redact: {
          paths: ['req.headers.cookie', 'req.headers.authorization', 'body.password', 'body.totpCode', 'body.currentPassword', 'body.newPassword'],
          censor: '***',
        },
        customProps: (req) => ({
          requestId: req.id,
          userId: (req as any).authUser?.sub,
          tenantId: (req as any).authUser?.tenantId,
        }),
        autoLogging: {
          ignore: (req) => (req as any).url === '/health',
        },
      },
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
