import { Module } from '@nestjs/common'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { SupportController } from './support.controller'
import { SupportService } from './support.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
