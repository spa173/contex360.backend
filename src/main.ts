import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'

import { json, urlencoded } from 'express'

import { validateEnv } from './common/env-validator'

const logger = new Logger('Bootstrap')

export async function bootstrap() {
  validateEnv()
  const app = await NestFactory.create(AppModule)
  const configService = app.get(ConfigService)

  app.use(json({ limit: '50mb' }))
  app.use(urlencoded({ extended: true, limit: '50mb' }))
  
  const corsOrigin = configService.get<string>('CORS_ORIGIN')
  const allowedOrigins = corsOrigin ? corsOrigin.split(',') : true

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With,x-tenant-id',
    exposedHeaders: 'Authorization',
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })

  const appName = configService.get<string>('APP_NAME') ?? 'Contex360 Backend'
  const port = Number(configService.get<string>('PORT') ?? 3001)
  const swaggerPath = configService.get<string>('SWAGGER_PATH') ?? 'docs'

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  )

  app.useGlobalInterceptors(new LoggingInterceptor())

  const swaggerConfig = new DocumentBuilder()
    .setTitle(appName)
    .setDescription('API base para Contex360')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup(swaggerPath, app, document)

  // Solo hacemos listen si NO estamos en entorno de Vite (donde Vite maneja el servidor)
  if (!process.env.VITE) {
    await app.listen(port, '0.0.0.0')
    const url = await app.getUrl()
    logger.log(`${appName} running at ${url}`)
  }

  return app
}

export const viteNodeApp = process.env.VITE ? bootstrap() : null;

if (!process.env.VITE) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    logger.error('Failed to start backend', message)
    process.exit(1)
  })
}
