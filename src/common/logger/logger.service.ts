import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common'
import pino from 'pino'

let sentryAvailable = false
try {
  if (process.env.SENTRY_DSN) {
    require('@sentry/node')
    sentryAvailable = true
  }
} catch {
  sentryAvailable = false
}

const transport = process.env.NODE_ENV !== 'production'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'body.password', 'body.totpCode'],
})

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger = pinoLogger

  log(message: any, ...optionalParams: any[]) {
    this.logger.info(message, ...optionalParams)
  }

  error(message: any, ...optionalParams: any[]) {
    this.logger.error(message, ...optionalParams)
    if (sentryAvailable && process.env.NODE_ENV === 'production') {
      try {
        const Sentry = require('@sentry/node')
        const err = message instanceof Error ? message : new Error(typeof message === 'string' ? message : String(message))
        Sentry.captureException(err, { extra: { optionalParams } })
      } catch {}
    }
  }

  warn(message: any, ...optionalParams: any[]) {
    this.logger.warn(message, ...optionalParams)
  }

  debug(message: any, ...optionalParams: any[]) {
    this.logger.debug(message, ...optionalParams)
  }

  verbose(message: any, ...optionalParams: any[]) {
    this.logger.trace(message, ...optionalParams)
  }

  fatal(message: any, ...optionalParams: any[]) {
    this.logger.fatal(message, ...optionalParams)
    if (sentryAvailable && process.env.NODE_ENV === 'production') {
      try {
        const Sentry = require('@sentry/node')
        const err = message instanceof Error ? message : new Error(typeof message === 'string' ? message : String(message))
        Sentry.captureException(err, { level: 'fatal', extra: { optionalParams } })
      } catch {}
    }
  }

  child(bindings: Record<string, any>): LoggerService {
    const child = new LoggerService()
    ;(child as any).logger = pinoLogger.child(bindings)
    return child
  }

  getPinoInstance() {
    return this.logger
  }
}
