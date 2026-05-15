import { Module } from '@nestjs/common'
import { LedgerService } from './ledger.service'
import { LedgerController } from './ledger.controller'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
