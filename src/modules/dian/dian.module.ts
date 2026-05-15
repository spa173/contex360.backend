import { Module } from '@nestjs/common'
import { DianService } from './dian.service'
import { DianController } from './dian.controller'
import { PrismaModule } from '../database/prisma.module'

import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [DianService],
  controllers: [DianController],
  exports: [DianService],
})
export class DianModule {}
