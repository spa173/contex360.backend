import { Test, TestingModule } from '@nestjs/testing'
import { LedgerService } from './ledger.service'
import { PrismaService } from '../database/prisma.service'
import { BadRequestException } from '@nestjs/common'

describe('LedgerService', () => {
  let service: LedgerService
  let prisma: PrismaService

  const mockPrisma = {
    ledgerEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get<LedgerService>(LedgerService)
    prisma = module.get<PrismaService>(PrismaService)
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('create', () => {
    it('should throw BadRequestException if debit and credit do not balance', async () => {
      const dto = {
        referenceType: 'test',
        description: 'Test entry',
        amount: 1000,
        lines: [
          { account: '110505', label: 'Caja', debit: 1000, credit: 0 },
          { account: '413595', label: 'Ventas', debit: 0, credit: 900 }, // Descuadre de 100
        ],
      }

      await expect(service.create('tenant-1', dto)).rejects.toThrow(BadRequestException)
      await expect(service.create('tenant-1', dto)).rejects.toThrow('El asiento no cuadra: débitos 1000 ≠ créditos 900')
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled()
    })

    it('should create ledger entry successfully if lines balance', async () => {
      const dto = {
        referenceType: 'invoice',
        referenceId: 'inv-1',
        description: 'Venta',
        amount: 1000,
        lines: [
          { account: '110505', label: 'Caja', debit: 1000, credit: 0 },
          { account: '413595', label: 'Ventas', debit: 0, credit: 1000 },
        ],
      }

      mockPrisma.ledgerEntry.create.mockResolvedValue({ id: 'entry-1', ...dto })

      const result = await service.create('tenant-1', dto)
      expect(result).toBeDefined()
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalled()
    })

    it('should throw BadRequestException if no lines are provided', async () => {
      const dto = {
        referenceType: 'test',
        description: 'Test entry',
        amount: 0,
        lines: [],
      }

      await expect(service.create('tenant-1', dto)).rejects.toThrow(BadRequestException)
      await expect(service.create('tenant-1', dto)).rejects.toThrow('El asiento debe tener al menos una línea')
    })
  })

  describe('getBalanceSheet', () => {
    it('should group assets, liabilities, and equity correctly', async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: '1',
          tenantId: 'tenant-1',
          lines: [
            { account: '110505', debit: 5000, credit: 0 }, // Caja
            { account: '310505', debit: 0, credit: 5000 }, // Capital
          ],
        },
      ])

      const balance = await service.getBalanceSheet('tenant-1')
      expect(balance.totalAssets).toBe(5000)
      expect(balance.totalEquity).toBe(-5000) // credits are negative in this logic
    })
  })
})
