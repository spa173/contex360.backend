import { Module } from '@nestjs/common'
import { QuotesService } from './quotes.service'
import { QuotesController } from './quotes.controller'
import { PrismaModule } from '../database/prisma.module'
import { InvoicesModule } from '../invoices/invoices.module'

@Module({
  imports: [PrismaModule, InvoicesModule],
  providers: [QuotesService],
  controllers: [QuotesController],
  exports: [QuotesService],
})
export class QuotesModule {}
