import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'

const logger = new Logger('Bootstrap')

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  
  // Habilitar CORS de la forma más sencilla y estándar de NestJS
  app.enableCors({
    origin: true, // Refleja el origin de la petición
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,X-Requested-With',
    exposedHeaders: 'Authorization',
    preflightContinue: false,
    optionsSuccessStatus: 200,
  })

  const configService = app.get(ConfigService)
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

  await app.listen(port, '0.0.0.0')

  const url = await app.getUrl()
  logger.log(`${appName} running at ${url}`)
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  logger.error('Failed to start backend', message)
  process.exit(1)
})
