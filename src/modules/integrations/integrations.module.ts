import { Module } from '@nestjs/common'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { GmailController } from './gmail.controller'
import { GmailService } from './gmail.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [GmailController],
  providers: [GmailService],
  exports: [GmailService],
})
export class IntegrationsModule {}
