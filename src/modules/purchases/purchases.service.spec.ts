import { Test, TestingModule } from '@nestjs/testing'
import { PurchasesService } from './purchases.service'
import { PrismaService } from '../database/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { PurchaseStatus } from '@prisma/client'

describe('PurchasesService', () => {
  let service: PurchasesService
  let ledgerService: LedgerService

  const mockPrisma = {
    $transaction: vi.fn(async (cb) => {
      return cb(mockPrisma)
    }),
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    purchase: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    },
    thirdParty: {
      findUnique: vi.fn(),
    },
  }

  const mockLedger = {
    create: vi.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile()

    service = module.get<PurchasesService>(PurchasesService)
    ledgerService = module.get<LedgerService>(LedgerService)
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('create', () => {
    it('should create a purchase and a ledger entry', async () => {
      mockPrisma.tenant.update.mockResolvedValue({ purchasePrefix: 'OC', lastPurchaseNumber: 1 })
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Item', isInventoriable: true })
      mockPrisma.purchase.create.mockResolvedValue({ id: 'pur-1', number: 'OC-000001' })
      mockPrisma.thirdParty.findUnique.mockResolvedValue({ name: 'Provider A' })

      const dto = {
        providerId: 'prov-1',
        paymentTermDays: 15,
        items: [
          { productId: 'prod-1', productName: 'Item', quantity: 10, unitPrice: 500, taxRate: 19 } // subtotal = 5000, tax = 950, total = 5950
        ]
      }

      const result = await service.create('tenant-1', dto)
      
      expect(result.id).toBe('pur-1')
      
      // Stock update
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { stock: { increment: 10 } }
      })

      // Ledger check
      expect(mockLedger.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
        amount: 5950,
        referenceType: 'purchase',
        referenceId: 'pur-1'
      }), mockPrisma)

      const ledgerCallArgs = mockLedger.create.mock.calls[0][1]
      expect(ledgerCallArgs.lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: '510000', debit: 5000, credit: 0 }),
        expect.objectContaining({ account: '240810', debit: 950, credit: 0 }),
        expect.objectContaining({ account: '220500', debit: 0, credit: 5950 })
      ]))
    })
  })

  describe('updateStatus', () => {
    it('should create a ledger entry when marked as paid', async () => {
      mockPrisma.purchase.findFirst.mockResolvedValue({ id: 'pur-1', total: 5950, number: 'OC-000001' })
      mockPrisma.purchase.update.mockResolvedValue({ id: 'pur-1', status: PurchaseStatus.paid })

      await service.updateStatus('tenant-1', 'pur-1', PurchaseStatus.paid)

      expect(mockLedger.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
        amount: 5950,
        referenceType: 'payment_out'
      }))

      const ledgerLines = mockLedger.create.mock.calls[0][1].lines
      expect(ledgerLines).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: '220500', debit: 5950, credit: 0 }),
        expect.objectContaining({ account: '110505', debit: 0, credit: 5950 })
      ]))
    })
  })
})
