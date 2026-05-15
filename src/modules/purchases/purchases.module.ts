import { Module } from '@nestjs/common'
import { PurchasesService } from './purchases.service'
import { PurchasesController } from './purchases.controller'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { LedgerModule } from '../ledger/ledger.module'

@Module({
  imports: [PrismaModule, AuthModule, LedgerModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
