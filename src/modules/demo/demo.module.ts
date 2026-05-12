import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [PrismaModule, TelegramModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
