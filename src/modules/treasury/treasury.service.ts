import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { TransactionType, TransactionCategory } from '@prisma/client'

export interface CreateTransactionDto {
  type: TransactionType
  amount: number
  date?: string
  description: string
  category?: TransactionCategory
  reference?: string
  invoiceId?: string
  purchaseId?: string
}

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.transaction.findMany({
      where: { tenantId },
      include: {
        invoice: { select: { id: true, number: true } },
        purchase: { select: { id: true, number: true } },
      },
      orderBy: { date: 'desc' },
    })
  }

  async getBalance(tenantId: string) {
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [all, thisMonth] = await Promise.all([
      this.prisma.transaction.findMany({ where: { tenantId }, select: { type: true, amount: true } }),
      this.prisma.transaction.findMany({
        where: { tenantId, date: { gte: firstOfMonth } },
        select: { type: true, amount: true },
      }),
    ])

    const total = all.reduce((acc, t) => {
      const amt = Number(t.amount)
      return t.type === TransactionType.INCOME ? acc + amt : acc - amt
    }, 0)

    const incomeMonth = thisMonth
      .filter((t) => t.type === TransactionType.INCOME)
      .reduce((s, t) => s + Number(t.amount), 0)

    const expenseMonth = thisMonth
      .filter((t) => t.type === TransactionType.EXPENSE)
      .reduce((s, t) => s + Number(t.amount), 0)

    return { balance: total, incomeMonth, expenseMonth }
  }

  async create(tenantId: string, dto: CreateTransactionDto) {
    if (dto.invoiceId) {
      const inv = await this.prisma.invoice.findFirst({ where: { id: dto.invoiceId, tenantId } })
      if (!inv) throw new NotFoundException('Factura no encontrada')
    }
    if (dto.purchaseId) {
      const pur = await this.prisma.purchase.findFirst({ where: { id: dto.purchaseId, tenantId } })
      if (!pur) throw new NotFoundException('Compra no encontrada')
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        tenantId,
        type: dto.type,
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        description: dto.description,
        category: dto.category ?? TransactionCategory.CAJA,
        reference: dto.reference,
        invoiceId: dto.invoiceId ?? null,
        purchaseId: dto.purchaseId ?? null,
      },
      include: {
        invoice: { select: { id: true, number: true } },
        purchase: { select: { id: true, number: true } },
      },
    })

    // Generate ledger entry automatically
    const cashAccount = dto.category === TransactionCategory.BANCO ? '110510' : '110505'
    const cashLabel = dto.category === TransactionCategory.BANCO ? 'Bancos' : 'Caja general'

    if (dto.type === TransactionType.INCOME) {
      await this.ledger.create(tenantId, {
        referenceType: 'payment_in',
        referenceId: transaction.id,
        description: dto.description,
        amount: dto.amount,
        lines: [
          { account: cashAccount, label: cashLabel, debit: dto.amount, credit: 0 },
          { account: '130505', label: 'Clientes nacionales', debit: 0, credit: dto.amount },
        ],
      })
    } else {
      await this.ledger.create(tenantId, {
        referenceType: 'payment_out',
        referenceId: transaction.id,
        description: dto.description,
        amount: dto.amount,
        lines: [
          { account: '220500', label: 'Proveedores nacionales', debit: dto.amount, credit: 0 },
          { account: cashAccount, label: cashLabel, debit: 0, credit: dto.amount },
        ],
      })
    }

    return transaction
  }
}
