import { AuthenticatedRequest } from './auth.types';

describe('Auth Types', () => {
  it('should define AuthenticatedRequest interface', () => {
    const request: Partial<AuthenticatedRequest> = {
      authUser: {
        email: 'test@example.com',
        tenantId: 'tenant-1',
      } as any,
    };

    expect(request.authUser).toBeDefined();
    expect(request.authUser?.email).toBe('test@example.com');
    expect(request.authUser?.tenantId).toBe('tenant-1');
  });
});
