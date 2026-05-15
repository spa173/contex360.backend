import { Module } from '@nestjs/common'
import { DianService } from './dian.service'
import { DianController } from './dian.controller'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [DatabaseModule],
  providers: [DianService],
  controllers: [DianController],
  exports: [DianService],
})
export class DianModule {}
