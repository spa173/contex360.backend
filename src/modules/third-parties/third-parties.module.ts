import { Module } from '@nestjs/common'
import { ThirdPartiesService } from './third-parties.service'
import { ThirdPartiesController } from './third-parties.controller'
import { PrismaModule } from '../database/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ThirdPartiesController],
  providers: [ThirdPartiesService],
  exports: [ThirdPartiesService],
})
export class ThirdPartiesModule {}
