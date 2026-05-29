import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { OcrController } from './ocr.controller'
import { OcrService } from './ocr.service'
import { OcrProcessor } from './ocr.processor'
import { OcrScheduler } from './ocr.scheduler'
import { PrismaModule } from '../database/prisma.module'
import { UsageModule } from '../usage/usage.module'
import { AiModule } from '../ai/ai.module'
import { StorageModule } from '../../common/storage/storage.module'

@Module({
  imports: [
    PrismaModule,
    UsageModule,
    AiModule,          // provides GeminiService
    StorageModule,     // provides STORAGE_PROVIDER (R2 or local)
    MulterModule.register({
      // Using memoryStorage — files go to buffer, OcrService uploads to R2/local
      // Never write Multer files to disk: containers are ephemeral
      storage: undefined,  // defaults to memoryStorage
    }),
  ],
  controllers: [OcrController],
  providers: [OcrService, OcrProcessor, OcrScheduler],
  exports: [OcrService],
})
export class OcrModule {}
