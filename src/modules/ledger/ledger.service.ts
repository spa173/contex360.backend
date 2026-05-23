import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

export interface CreateLedgerEntryDto {
  referenceType: string
  referenceId?: string
  description: string
  amount: number
  entryAt?: string
  lines: {
    account: string
    label: string
    debit: number
    credit: number
  }[]
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { tenantId },
      include: { lines: true },
      orderBy: { entryAt: 'desc' },
    })
  }

  async findUnreconciled(tenantId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { tenantId, reconciled: false },
      include: { lines: true },
      orderBy: { entryAt: 'desc' },
    })
  }

  async reconcileEntry(tenantId: string, id: string) {
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { id, tenantId },
    })
    if (!entry) {
      throw new BadRequestException('Asiento no encontrado.')
    }
    return this.prisma.ledgerEntry.update({
      where: { id },
      data: { reconciled: true, reconciledAt: new Date() },
      include: { lines: true },
    })
  }

  async create(tenantId: string, dto: CreateLedgerEntryDto, tx?: any) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('El asiento debe tener al menos una línea')
    }

    const debitTotal = dto.lines.reduce((sum, l) => sum + Number(l.debit), 0)
    const creditTotal = dto.lines.reduce((sum, l) => sum + Number(l.credit), 0)

    if (Math.abs(debitTotal - creditTotal) > 0.01) {
      throw new BadRequestException(
        `El asiento no cuadra: débitos ${debitTotal} ≠ créditos ${creditTotal}`,
      )
    }

    const prisma = tx ?? this.prisma
    return prisma.ledgerEntry.create({
      data: {
        tenantId,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId ?? null,
        description: dto.description,
        amount: dto.amount,
        entryAt: dto.entryAt ? new Date(dto.entryAt) : new Date(),
        lines: {
          create: dto.lines.map((line) => ({
            account: line.account,
            label: line.label,
            debit: line.debit,
            credit: line.credit,
          })),
        },
      },
      include: { lines: true },
    })
  }
}
