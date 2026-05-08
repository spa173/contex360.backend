import { Test, TestingModule } from '@nestjs/testing';
import { ThirdPartiesService } from './third-parties.service';
import { PrismaService } from '../database/prisma.service';

describe('ThirdPartiesService', () => {
  let service: ThirdPartiesService;
  let prisma: PrismaService;

  const mockPrisma = {
    thirdParty: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThirdPartiesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ThirdPartiesService>(ThirdPartiesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('findAll returns third parties for a tenant', async () => {
    const mockList = [{ id: '1', name: 'Client A', tenantId: 'tenant-1' }];
    mockPrisma.thirdParty.findMany.mockResolvedValue(mockList);

    const result = await service.findAll('tenant-1');
    expect(result).toEqual(mockList);
    expect(prisma.thirdParty.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      orderBy: { name: 'asc' },
    });
  });

  it('findOne returns a single third party', async () => {
    const mock = { id: '1', name: 'Client A', tenantId: 'tenant-1' };
    mockPrisma.thirdParty.findFirst.mockResolvedValue(mock);
    const result = await service.findOne('tenant-1', '1');
    expect(result).toEqual(mock);
  });

  it('create adds a new third party', async () => {
    const dto = { name: 'New', nit: '1', email: 'a@b.com', type: 'client' };
    mockPrisma.thirdParty.create.mockResolvedValue({ id: '2', ...dto });
    const result = await service.create('tenant-1', dto as any);
    expect(result.id).toBe('2');
  });

  it('update modifies a third party', async () => {
    mockPrisma.thirdParty.findFirst.mockResolvedValue({ id: '1', tenantId: 'tenant-1' });
    mockPrisma.thirdParty.update.mockResolvedValue({ id: '1', name: 'Updated' });
    const result = await service.update('tenant-1', '1', { name: 'Updated' } as any);
    expect(result.name).toBe('Updated');
  });

  it('remove deletes a third party', async () => {
    mockPrisma.thirdParty.findFirst.mockResolvedValue({ id: '1', tenantId: 'tenant-1' });
    mockPrisma.thirdParty.delete.mockResolvedValue({ id: '1' });
    await service.remove('tenant-1', '1');
    expect(prisma.thirdParty.delete).toHaveBeenCalled();
  });
});
