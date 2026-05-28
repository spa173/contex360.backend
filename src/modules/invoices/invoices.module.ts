import { Module } from '@nestjs/common'
import { InvoicesService } from './invoices.service'
import { InvoicesController } from './invoices.controller'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { LedgerModule } from '../ledger/ledger.module'
import { InvoiceMailerService } from './invoice-mailer.service'
import { UsageModule } from '../usage/usage.module'

@Module({
  imports: [PrismaModule, AuthModule, LedgerModule, UsageModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoiceMailerService],
  exports: [InvoicesService, InvoiceMailerService],
})
export class InvoicesModule {}
