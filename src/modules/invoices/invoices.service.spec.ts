import { Test, TestingModule } from '@nestjs/testing'
import { InvoicesService } from './invoices.service'
import { PrismaService } from '../database/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { BadRequestException } from '@nestjs/common'
import { InvoiceStatus } from '@prisma/client'
import { UsageService } from '../usage/usage.service'

describe('InvoicesService', () => {
  let service: InvoicesService
  let ledgerService: LedgerService

  const mockPrisma = {
    $transaction: vi.fn(async (cb) => {
      // Pass the mockPrisma as the transaction context
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
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    },
    subscription: {
      updateMany: vi.fn(),
    },
    thirdParty: {
      findUnique: vi.fn(),
    },
  }

  const mockLedger = {
    create: vi.fn(),
  }

  const mockUsageService = {
    recordUsage: vi.fn(),
    getUsage: vi.fn(),
    checkLimit: vi.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
        { provide: UsageService, useValue: mockUsageService },
      ],
    }).compile()

    service = module.get<InvoicesService>(InvoicesService)
    ledgerService = module.get<LedgerService>(LedgerService)
    vi.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('create', () => {
    it('should create an invoice and ledger entry if stock is sufficient', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', allowNegativeStock: false })
      mockPrisma.tenant.update.mockResolvedValue({ invoicePrefix: 'FE', lastInvoiceNumber: 1 })
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Service', isInventoriable: false, cost: 0, taxRate: 19 })
      
      mockPrisma.invoice.create.mockResolvedValue({
        id: 'inv-1',
        number: 'FE-000001',
        status: InvoiceStatus.emitted,
      })
      mockPrisma.thirdParty.findUnique.mockResolvedValue({ name: 'Client A' })

      const dto = {
        clientId: 'cli-1',
        paymentTermDays: 30,
        items: [
          { productId: 'prod-1', quantity: 2, unitPrice: 1000, taxRate: 19 } // subtotal = 2000, tax = 380, total = 2380
        ]
      }

      const result = await service.create('tenant-1', dto)
      
      expect(result.id).toBe('inv-1')
      expect(mockLedger.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
        amount: 2380,
        referenceType: 'invoice',
        referenceId: 'inv-1'
      }), mockPrisma)
      
      // Verify ledger lines have correct amounts
      const ledgerCallArgs = mockLedger.create.mock.calls[0][1]
      expect(ledgerCallArgs.lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ account: '130505', debit: 2380, credit: 0 }),
        expect.objectContaining({ account: '413595', debit: 0, credit: 2000 }),
        expect.objectContaining({ account: '240805', debit: 0, credit: 380 })
      ]))
    })

    it('should throw BadRequestException if stock is insufficient', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', allowNegativeStock: false })
      mockPrisma.tenant.update.mockResolvedValue({ invoicePrefix: 'FE', lastInvoiceNumber: 1 })
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Physical Item', isInventoriable: true, stock: 1, cost: 500 })
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' })

      const dto = {
        clientId: 'cli-1',
        paymentTermDays: 30,
        items: [
          { productId: 'prod-1', quantity: 5, unitPrice: 1000, taxRate: 19 }
        ]
      }

      await expect(service.create('tenant-1', dto)).rejects.toThrow(BadRequestException)
      await expect(service.create('tenant-1', dto)).rejects.toThrow('Stock insuficiente para Physical Item. Disponible: 1, Requerido: 5')
      expect(mockLedger.create).not.toHaveBeenCalled()
    })
       })

    it('should create invoice when taxRate omitted in DTO (uses product taxRate)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', allowNegativeStock: false });
      mockPrisma.tenant.update.mockResolvedValue({ invoicePrefix: 'FE', lastInvoiceNumber: 1 });
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-1', name: 'Service', isInventoriable: false, cost: 0, taxRate: 19 });
      mockPrisma.invoice.create.mockResolvedValue({
        id: 'inv-2',
        number: 'FE-000002',
        status: InvoiceStatus.emitted,
      });
      mockPrisma.thirdParty.findUnique.mockResolvedValue({ name: 'Client A' });

      const dto = {
        clientId: 'cli-1',
        paymentTermDays: 30,
        items: [{ productId: 'prod-1', quantity: 2, unitPrice: 1000 }],
      };

      const result = await service.create('tenant-1', dto);
      expect(result.id).toBe('inv-2');
      expect(mockLedger.create).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ amount: 2380, referenceType: 'invoice', referenceId: 'inv-2' }),
        mockPrisma,
      );
    });
})
