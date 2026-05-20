import { describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service';
import { PLANS } from './plans.config';

const prismaMock = {
  subscription: {
    findUnique: vi.fn(),
  },
} as any;

describe('SubscriptionsService', () => {
  it('should return starter limits if subscription is not found', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue(null);
    const service = new SubscriptionsService(prismaMock);
    const result = await service.getCurrentSubscription('tenant-id');

    expect(result.planType).toBe('starter');
    expect(result.limits).toEqual(PLANS.starter);
  });

  it('should return specific plan limits if subscription exists', async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-id',
      planType: 'pyme',
      active: true,
      trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      invoicesThisMonth: 10,
    });
    const service = new SubscriptionsService(prismaMock);
    const result = await service.getCurrentSubscription('tenant-id');

    expect(result.planType).toBe('pyme');
    expect(result.limits).toEqual(PLANS.pyme);
    expect(result.trialDaysRemaining).toBe(10);
    expect(result.invoicesThisMonth).toBe(10);
  });
});
