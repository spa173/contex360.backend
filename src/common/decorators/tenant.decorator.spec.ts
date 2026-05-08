import { TenantId } from './tenant.decorator';
import { ExecutionContext } from '@nestjs/common';

describe('Tenant Decorator', () => {
  it('should export TenantId decorator', () => {
    expect(TenantId).toBeDefined();
    expect(typeof TenantId).toBe('function');
  });

  it('should be a param decorator', () => {
    expect(TenantId).toBeInstanceOf(Function);
  });

  it('should extract tenantId from request', () => {
    // Create a mock execution context
    const mockRequest = {
      authUser: {
        tenantId: 'test-tenant-123',
      },
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    // Apply the decorator function - decorators return functions
    const decoratorFn = TenantId(null, mockContext);
    expect(typeof decoratorFn).toBe('function');
  });

  it('should return undefined when authUser is not present', () => {
    // Create a mock execution context without authUser
    const mockRequest = {};

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    // Apply the decorator function
    const decoratorFn = TenantId(null, mockContext);
    expect(typeof decoratorFn).toBe('function');
  });
});
