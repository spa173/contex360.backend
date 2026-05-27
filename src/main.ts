import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'

import { json, urlencoded } from 'express'
import helmet from 'helmet'

import { validateEnv } from './common/env-validator'

const logger = new Logger('Bootstrap')

let appInstance: any = null

export async function bootstrap() {
  if (appInstance) {
    try {
      await appInstance.close()
    } catch (e) {
      // ignore
    }
  }

  validateEnv()
  const app = await NestFactory.create(AppModule)
  appInstance = app
  const configService = app.get(ConfigService)

  // Bancolombia // Hugging Face termina TLS en el proxy y reenvía la IP real
  // en X-Forwarded-For. Sin esto: rate limiting por IP del proxy,
  // sesiones con IP incorrecta y cookies secure rechazadas en HTTP interno.
  const expressApp = app.getHttpAdapter().getInstance()
  expressApp.set('trust proxy', 1)

  app.use(json({ limit: '50mb' }))
  app.use(urlencoded({ extended: true, limit: '500mb' }))
  
  const corsOrigin = configService.get<string>('CORS_ORIGIN')
  const allowedOrigins = corsOrigin ? corsOrigin.split(',') : true

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With,x-tenant-id,X-CSRF-Token',
    exposedHeaders: 'Authorization',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })

  // Security headers via Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://*.hf.space", "https://huggingface.co"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  }))

  const appName = configService.get<string>('APP_NAME') ?? 'Contex360 Backend'
  const port = Number(configService.get<string>('PORT') ?? 3001)
  const swaggerPath = configService.get<string>('SWAGGER_PATH') ?? 'docs'
  const isProduction = process.env.NODE_ENV === 'production'

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  )

  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new LoggingInterceptor())

  // Swagger solo en desarrollo — deshabilitado en producción por seguridad
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(appName)
      .setDescription('API base para Contex360')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build()

    try {
      const document = SwaggerModule.createDocument(app, swaggerConfig)
      SwaggerModule.setup(swaggerPath, app, document)
    } catch (error: any) {
      logger.warn(`Failed to generate Swagger documentation: ${String(error.message || error).replace(/[\r\n]+/g, ' ')}`)
    }
  }

  // Solo hacemos listen si NO estamos en entorno de Vite (donde Vite maneja el servidor)
  if (!process.env.VITE) {
    await app.listen(port, '0.0.0.0')
    const url = await app.getUrl()
    logger.log(`${appName} running at ${url}`)
  }

  return app
}

export const viteNodeApp = process.env.VITE
  ? bootstrap().catch((err: unknown) => {
      logger.error('Failed to bootstrap Vite app', err instanceof Error ? err.stack ?? err.message : String(err))
    })
  : null;

if (!process.env.VITE) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    logger.error('Failed to start backend', message.replace(/[\r\n]+/g, ' '))
    process.exit(1)
  })
}
