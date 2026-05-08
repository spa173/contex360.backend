import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../database/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: PrismaService;

  const mockPrisma = {
    invoice: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    product: {
      aggregate: vi.fn(),
      count: vi.fn(),
      fields: { minStock: 'minStock' }
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('getDashboardKpis returns aggregated stats', async () => {
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { total: 1000 } });
    mockPrisma.product.aggregate.mockResolvedValue({ _sum: { stock: 50 } });
    mockPrisma.product.count.mockResolvedValue(5);

    const result = await service.getDashboardKpis('tenant-1');
    expect(result.totalSales).toBe(1000);
    expect(result.totalStockItems).toBe(50);
    expect(result.lowStockAlerts).toBe(5);
  });

  it('getSalesByMonth groups sales correctly', async () => {
    const date = new Date('2024-01-15');
    mockPrisma.invoice.findMany.mockResolvedValue([
      { total: 500, issuedAt: date },
      { total: 200, issuedAt: date },
    ]);

    const result = await service.getSalesByMonth('tenant-1');
    expect(result[0].total).toBe(700);
    expect(result[0].name).toBe('2024-01');
  });

  it('exportInvoicesCsv generates CSV content', async () => {
     mockPrisma.invoice.findMany.mockResolvedValue([
       { id: '1', total: 100, status: 'emitted', issuedAt: new Date(), client: { name: 'C1' } }
     ]);
     const csv = await service.exportInvoicesCsv('tenant-1');
     expect(csv).toContain('ID,Fecha,Cliente,Total,Estado');
     expect(csv).toContain('C1,100,emitted');
  });
});
