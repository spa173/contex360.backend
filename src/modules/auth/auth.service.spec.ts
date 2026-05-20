import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userSession: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  subscription: {
    findUnique: vi.fn(),
  },
} as any;

const jwtServiceMock = {} as any;
const totpServiceMock = {} as any;
const notificationServiceMock = {} as any;

describe('AuthService.me', () => {
  it('should return subscription details in bootstrap payload', async () => {
    const authUser = {
      sub: 'user-id',
      sessionId: 'session-id',
      tenantId: 'tenant-id',
      email: 'user@test.com',
      isSystemOwner: false,
      tenantIds: ['tenant-id'],
    };

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-id',
      name: 'Test User',
      email: 'user@test.com',
      title: 'Member',
      status: 'active',
      isSystemOwner: false,
      isDemoAccount: false,
      memberships: [
        {
          userId: 'user-id',
          tenantId: 'tenant-id',
          role: 'owner',
          tenant: {
            id: 'tenant-id',
            name: 'Test Tenant',
            prefix: 'test',
            allowNegativeStock: false,
          },
        },
      ],
      securityProfile: {
        twoFactorEnabled: false,
      },
    });

    prismaMock.userSession.findUnique.mockResolvedValue({
      id: 'session-id',
      userId: 'user-id',
      tenantId: 'tenant-id',
      ip: '127.0.0.1',
      location: 'Local',
      device: 'Chrome',
      browser: 'Chrome',
      os: 'Windows',
      fingerprint: 'fp',
      createdAt: new Date(),
      lastSeenAt: new Date(),
    });

    prismaMock.userSession.update.mockResolvedValue({});

    prismaMock.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-id',
      planType: 'starter',
      active: true,
      trialEndsAt: null,
      invoicesThisMonth: 5,
    });

    const service = new AuthService(prismaMock, jwtServiceMock, totpServiceMock, notificationServiceMock);
    const result = await service.me(authUser);

    expect(result.ok).toBe(true);
    expect(result.subscription).toBeDefined();
    expect(result.subscription?.planType).toBe('starter');
    expect(result.subscription?.limits.maxInvoicesPerMonth).toBe(50);
  });
});
