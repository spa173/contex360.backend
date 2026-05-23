import { Module } from '@nestjs/common'
import { DianService } from './dian.service'
import { DianController } from './dian.controller'
import { PrismaModule } from '../database/prisma.module'

import { AuthModule } from '../auth/auth.module'
import { InvoicesModule } from '../invoices/invoices.module'

@Module({
  imports: [PrismaModule, AuthModule, InvoicesModule],
  providers: [DianService],
  controllers: [DianController],
  exports: [DianService],
})
export class DianModule {}
