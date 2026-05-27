import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { CreateLedgerEntryDto } from './ledger.dto'

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
      where: { tenantId, reconciled: false } as any,
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
      data: { reconciled: true, reconciledAt: new Date() } as any,
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

  async getBalanceSheet(tenantId: string) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { tenantId },
      include: { lines: true },
    })

    const accounts: Record<string, number> = {}
    entries.forEach((entry) => {
      entry.lines.forEach((line) => {
        const amt = Number(line.debit) - Number(line.credit)
        accounts[line.account] = (accounts[line.account] || 0) + amt
      })
    })

    const createNode = (code: string, name: string, type: any) => ({ code, name, balance: accounts[code] || 0, children: [], type })
    const assets = [createNode('110505', 'Caja General', 'asset'), createNode('130505', 'Clientes', 'asset')]
    const liabilities = [createNode('240805', 'IVA por Pagar', 'liability')]
    const equity = [createNode('310505', 'Capital Social', 'equity')]
    
    return {
      at: new Date().toISOString(),
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, n) => s + n.balance, 0),
      totalLiabilities: liabilities.reduce((s, n) => s + n.balance, 0),
      totalEquity: equity.reduce((s, n) => s + n.balance, 0),
    }
  }

  async getProfitAndLoss(tenantId: string) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { tenantId },
      include: { lines: true },
    })

    const accounts: Record<string, number> = {}
    entries.forEach((entry) => {
      entry.lines.forEach((line) => {
        // Income statements usually show positive values for credits (Revenue) and debits (Expenses)
        const amt = Number(line.credit) - Number(line.debit)
        accounts[line.account] = (accounts[line.account] || 0) + amt
      })
    })

    const revenue = [{ code: '413595', name: 'Ingresos Operacionales', balance: accounts['413595'] || 0, children: [], type: 'revenue' }]
    const costs = [{ code: '613505', name: 'Costo de Ventas', balance: -(accounts['613505'] || 0), children: [], type: 'cost' }]
    const expenses = [{ code: '510505', name: 'Gastos de Personal', balance: -(accounts['510505'] || 0), children: [], type: 'expense' }, { code: '510000', name: 'Gastos operacionales de compra', balance: -(accounts['510000'] || 0), children: [], type: 'expense' }]
    
    const gross = revenue[0].balance - costs[0].balance
    const net = gross - expenses.reduce((s, n) => s + n.balance, 0)

    return {
      from: '2026-01-01',
      to: new Date().toISOString(),
      revenue,
      costs,
      expenses,
      grossProfit: gross,
      operatingProfit: gross,
      netProfit: net,
    }
  }
}
