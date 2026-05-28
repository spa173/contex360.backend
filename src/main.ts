import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

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
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  })
  appInstance = app
  app.useLogger(app.get(Logger))
  const configService = app.get(ConfigService)

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

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(appName)
      .setDescription('API base para Contex360')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addTag('Auth', 'Autenticación y gestión de sesiones')
      .addTag('Health', 'Monitoreo y estado del servidor')
      .addTag('Onboarding', 'Configuración inicial de empresa')
      .addTag('Products', 'Gestión de productos')
      .addTag('Invoices', 'Facturación electrónica')
      .addTag('Third Parties', 'Gestión de terceros')
      .addTag('Inventory', 'Control de inventario')
      .addTag('Purchases', 'Compras')
      .addTag('Treasury', 'Tesorería')
      .build()

    try {
      const document = SwaggerModule.createDocument(app, swaggerConfig)
      SwaggerModule.setup(swaggerPath, app, document)
      logger.log(`Swagger documentation available at /${swaggerPath}`)
    } catch (error: any) {
      logger.warn(`Failed to generate Swagger documentation: ${String(error.message || error).replace(/[\r\n]+/g, ' ')}`)
    }
  }

  // Graceful shutdown handlers
  const shutdownSignals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']
  shutdownSignals.forEach((signal) => {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, shutting down gracefully...`)
      try {
        await app.close()
        logger.log('Application closed successfully')
        process.exit(0)
      } catch (err) {
        logger.error(`Error during shutdown: ${err}`)
        process.exit(1)
      }
    })
  })

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
