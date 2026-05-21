import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'

/**
 * Captura TODAS las excepciones (HTTP y no-HTTP) y devuelve un JSON
 * estructurado con el detalle real del error.
 *
 * Sin este filtro, NestJS muestra solo "Internal server error" para
 * excepciones no-HTTP, lo cual dificulta el diagnóstico en producción.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message = 'Error interno del servidor'
    let details: string | undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>
        message = (body.message as string) || message

        if (Array.isArray(body.message)) {
          message = body.message.join('; ')
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message
      details = exception.stack?.replace(/[\r\n]+/g, ' ').slice(0, 500)
    }

    // Log completo para diagnóstico (solo errores 5xx)
    if (status >= 500) {
      const method = request?.method || 'UNKNOWN'
      const url = request?.url || '/'
      const errorLog = exception instanceof Error
        ? (exception.stack || exception.message).replace(/[\r\n]+/g, ' ')
        : String(exception)
      this.logger.error(`[${method} ${url}] ${status} — ${errorLog}`)
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(details && process.env.NODE_ENV !== 'production' ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request?.url,
    })
  }
}
