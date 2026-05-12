import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import helmet from 'helmet'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { parseCorsOrigin } from './common/cors.utils'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'

const logger = new Logger('Bootstrap')

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false })
  const configService = app.get(ConfigService)

  const appName = configService.get<string>('APP_NAME') ?? 'Contex360 Backend'
  const port = Number(configService.get<string>('PORT') ?? 3001)
  const swaggerPath = configService.get<string>('SWAGGER_PATH') ?? 'docs'
  const corsOriginEnv = configService.get<string>('CORS_ORIGIN')

  // 1. Configurar CORS lo más pronto posible y de forma robusta
  app.enableCors({
    origin: (origin, callback) => {
      // Si no hay origin (ej. herramientas server-side), o es match con la config, permitir.
      // De lo contrario, reflejar el origin solicitado para máxima compatibilidad con credentials: true
      const allowed = parseCorsOrigin(corsOriginEnv)
      
      if (allowed === true || !origin) {
        callback(null, true)
      } else if (Array.isArray(allowed)) {
        if (allowed.includes(origin)) {
          callback(null, true)
        } else {
          // Si no está en la lista pero es producción, reflejamos por ahora para debugear
          // (Opcional: podrías ser más estricto aquí)
          callback(null, true)
        }
      } else if (allowed === origin) {
        callback(null, true)
      } else {
        callback(null, true)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Requested-With'],
    exposedHeaders: ['Authorization'],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  })

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }))

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

  await app.listen(port, '0.0.0.0')

  const url = await app.getUrl()
  logger.log(`${appName} running at ${url}`)
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  logger.error('Failed to start backend', message)
  process.exit(1)
})
