import { Module } from '@nestjs/common'
import { DianService } from './dian.service'
import { DianController } from './dian.controller'
import { PrismaModule } from '../database/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [DianService],
  controllers: [DianController],
  exports: [DianService],
})
export class DianModule {}
