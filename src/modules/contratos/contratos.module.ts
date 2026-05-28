import { Module } from '@nestjs/common';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { PrismaService } from '../database/prisma.service';

@Module({
  controllers: [ContratosController],
  providers: [ContratosService, PrismaService],
  exports: [ContratosService],
})
export class ContratosModule {}
