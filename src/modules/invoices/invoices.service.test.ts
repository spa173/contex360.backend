import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../database/prisma.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: PrismaService;

  const mockPrisma = {
    invoice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(mockPrisma)),
    tenant: {
      findUnique: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    }
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll returns invoices for a tenant', async () => {
    const mockInvoices = [{ id: '1', number: 'INV-001', tenantId: 'tenant-1' }];
    mockPrisma.invoice.findMany.mockResolvedValue(mockInvoices);

    const result = await service.findAll('tenant-1');
    expect(result).toEqual(mockInvoices);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      include: { items: true, client: true },
      orderBy: { issuedAt: 'desc' },
    });
  });

  it('findOne returns a single invoice', async () => {
    const mockInvoice = { id: '1', number: 'INV-001', tenantId: 'tenant-1' };
    mockPrisma.invoice.findFirst.mockResolvedValue(mockInvoice);

    const result = await service.findOne('tenant-1', '1');
    expect(result).toEqual(mockInvoice);
  });

  it('create adds a new invoice', async () => {
    const dto = {
      number: 'INV-002',
      date: new Date(),
      dueDate: new Date(),
      total: 1000,
      subtotal: 900,
      tax: 100,
      thirdPartyId: 'tp-1',
      items: [{ productId: 'p1', quantity: 2, price: 500, total: 1000 }],
    };
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', allowNegativeStock: true });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1', name: 'Prod 1', stock: 10 });
    mockPrisma.invoice.create.mockResolvedValue({ id: '2', ...dto });

    const result = await service.create('tenant-1', dto as any);
    expect(result.id).toBe('2');
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it('remove deletes an invoice', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({ id: '1', tenantId: 'tenant-1' });
    mockPrisma.invoice.delete.mockResolvedValue({ id: '1' });
    await service.remove('tenant-1', '1');
    expect(prisma.invoice.delete).toHaveBeenCalledWith({
      where: { id: '1' },
    });
  });
});
