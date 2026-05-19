import { Module } from '@nestjs/common'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { GmailController } from './gmail.controller'
import { GmailService } from './gmail.service'
import { BancolombiaController } from './bancolombia.controller'
import { BancolombiaService } from './bancolombia.service'
import { TreasuryModule } from '../treasury/treasury.module'

@Module({
  imports: [PrismaModule, AuthModule, TreasuryModule],
  controllers: [GmailController, BancolombiaController],
  providers: [GmailService, BancolombiaService],
  exports: [GmailService, BancolombiaService],
})
export class IntegrationsModule {}
