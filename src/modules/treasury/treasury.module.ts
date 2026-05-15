import { Module } from '@nestjs/common'
import { TreasuryService } from './treasury.service'
import { TreasuryController } from './treasury.controller'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { LedgerModule } from '../ledger/ledger.module'

@Module({
  imports: [PrismaModule, AuthModule, LedgerModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
