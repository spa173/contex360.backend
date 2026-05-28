import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'

interface PrismaClientError {
  code?: string
  meta?: Record<string, unknown>
  message?: string
}

const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  P2000: 'El valor proporcionado es demasiado largo para la columna.',
  P2001: 'El registro solicitado no existe.',
  P2002: 'Ya existe un registro con ese valor único.',
  P2003: 'No se puede eliminar porque tiene registros relacionados.',
  P2004: 'Error de restricción en la base de datos.',
  P2005: 'El valor no es válido para el tipo de campo.',
  P2011: 'No se puede dejar el campo vacío.',
  P2014: 'La operación violaría la relación requerida.',
  P2016: 'Error al interpretar la consulta.',
  P2025: 'Registro no encontrado para actualizar o eliminar.',
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest()

    const errorResponse = this.normalizeError(exception, request)

    if (errorResponse.statusCode >= 500) {
      const errorLog = exception instanceof Error
        ? (exception.stack || exception.message).replace(/[\r\n]+/g, ' ')
        : String(exception)
      this.logger.error(`[${request?.method || 'UNKNOWN'} ${request?.url || '/'}] ${errorResponse.statusCode} — ${errorLog}`)
    }

    response.status(errorResponse.statusCode).json({
      statusCode: errorResponse.statusCode,
      message: errorResponse.message,
      errorCode: errorResponse.errorCode,
      ...(errorResponse.details && process.env.NODE_ENV !== 'production' ? { details: errorResponse.details } : {}),
      timestamp: new Date().toISOString(),
      path: request?.url,
    })
  }

  private normalizeError(exception: unknown, request: any): {
    statusCode: number
    message: string
    errorCode?: string
    details?: string
  } {
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception)
    }

    if (this.isPrismaError(exception)) {
      return this.handlePrismaError(exception)
    }

    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : exception.message,
        details: exception.stack?.replace(/[\r\n]+/g, ' ').slice(0, 500),
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
    }
  }

  private handleHttpException(exception: HttpException) {
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    let message = 'Error interno del servidor'
    let errorCode: string | undefined

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const body = exceptionResponse as Record<string, unknown>
      message = (body.message as string) || message
      if (Array.isArray(body.message)) {
        message = body.message.join('; ')
      }
      errorCode = body.errorCode as string | undefined
    }

    return { statusCode: status, message, errorCode }
  }

  private isPrismaError(error: unknown): error is PrismaClientError {
    if (typeof error !== 'object' || error === null) return false
    const err = error as PrismaClientError
    return typeof err.code === 'string' && err.code.startsWith('P') && !Number.isNaN(Number(err.code.slice(1)))
  }

  private handlePrismaError(error: PrismaClientError) {
    const code = error.code || 'P2000'
    const message = PRISMA_ERROR_MESSAGES[code] || 'Error de base de datos'
    const fields = error.meta?.target as string[] | undefined
    const details = fields ? `Campos: ${fields.join(', ')}` : undefined

    return {
      statusCode: HttpStatus.CONFLICT,
      message,
      errorCode: code,
      details,
    }
  }
}
