import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { SubscriptionsController } from './subscriptions.controller'
import { SubscriptionsService } from './subscriptions.service'
import { WompiService } from './wompi.service'
import { DianService } from '../dian/dian.service'
import { NotificationService } from '../notification/notification.service'

const mockPrisma = {
  tenant: { findUnique: vi.fn(), delete: vi.fn() },
  membership: { findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
  payment: { findUnique: vi.fn() },
  subscription: { update: vi.fn() },
  subscriptionInvoice: { update: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn() },
  thirdParty: { findMany: vi.fn() },
  invoice: { findMany: vi.fn() },
  purchase: { findMany: vi.fn() },
  transaction: { findMany: vi.fn() },
  ledgerEntry: { findMany: vi.fn() },
  userSession: { updateMany: vi.fn() },
  refreshToken: { updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  $transaction: vi.fn(async (arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma)
    if (Array.isArray(arg)) return Promise.all(arg.map((action: any) => (typeof action === 'function' ? action(mockPrisma) : action)))
    return Promise.resolve({})
  }),
}

const mockSubscriptionsService = {
  activateSubscription: vi.fn(),
  createPayment: vi.fn(),
  createSubscriptionInvoice: vi.fn(),
  cancelSubscription: vi.fn(),
  getPaymentHistory: vi.fn(),
  getInvoiceHistory: vi.fn(),
  getCurrentSubscription: vi.fn(),
  getUsage: vi.fn(),
  exportTenantData: vi.fn(),
  confirmCancellation: vi.fn(),
}

const mockWompiService = {
  verifyWebhook: vi.fn(),
  createPaymentLink: vi.fn(),
}

const mockDianService = {
  sendInvoice: vi.fn(),
}

const mockNotificationService = {
  sendEmail: vi.fn(),
  sendBulkEmail: vi.fn(),
  sendNotification: vi.fn(),
  sendGenericEmail: vi.fn(),
}

describe('SubscriptionsController — wompiWebhook', () => {
  let controller: SubscriptionsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new SubscriptionsController(
      mockSubscriptionsService as any,
      mockWompiService as any,
      mockPrisma as any,
      mockNotificationService as any,
      mockDianService as any,
      { generateInvoicePdf: vi.fn().mockReturnValue('/tmp/test.pdf') } as any,
      { sendInvoiceEmail: vi.fn() } as any,
      { getAvailableCurrencies: vi.fn().mockReturnValue([]) } as any,
    )
  })

  it('rechaza firma inválida con 400', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(false)

    await expect(controller.wompiWebhook('bad-sig', { data: {} } as any))
      .rejects.toThrow(BadRequestException)
  })

  it('ignora evento no APPROVED', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(true)
    const body = {
      type: 'transaction.updated',
      data: { transaction: { status: 'DECLINED' } },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockSubscriptionsService.activateSubscription).not.toHaveBeenCalled()
  })

  it('ignora evento con SKU faltante', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(true)
    const body = {
      type: 'transaction.updated',
      data: { transaction: { status: 'APPROVED' } },
      signature: { checksum: 'abc', properties: [] },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockSubscriptionsService.activateSubscription).not.toHaveBeenCalled()
  })

  it('ignora SKU inválido (menos de 3 partes)', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(true)
    const body = {
      type: 'transaction.updated',
      data: { sku: 'pyme_monthly', transaction: { status: 'APPROVED' } },
      signature: { checksum: 'abc', properties: [] },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockSubscriptionsService.activateSubscription).not.toHaveBeenCalled()
  })

  it('procesa webhook exitoso completamente', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(true)

    const sku = 'pyme_monthly_tenant-123'
    const mockSubscription = { id: 'sub-1', tenantId: 'tenant-123', planType: 'pyme', billing: 'monthly', active: true }
    const mockPayment = { id: 'pay-1', tenantId: 'tenant-123', amount: 189000 }
    const mockInvoice = { id: 'inv-1', invoiceNumber: 'SUB-202605-0001' }

    mockSubscriptionsService.activateSubscription.mockResolvedValue(mockSubscription)
    mockSubscriptionsService.createPayment.mockResolvedValue(mockPayment)
    mockSubscriptionsService.createSubscriptionInvoice.mockResolvedValue(mockInvoice)
    mockPrisma.payment.findUnique.mockResolvedValue(null)
    mockPrisma.subscription.update.mockResolvedValue({})

    const body = {
      type: 'transaction.updated',
      data: {
        transaction: {
          id: 'txn-001',
          status: 'APPROVED',
          amount_in_cents: 18900000,
          payment_method: { type: 'CARD' },
        },
        reference: sku,
      },
      signature: { checksum: 'abc', properties: ['transaction.id', 'transaction.status'] },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockSubscriptionsService.activateSubscription).toHaveBeenCalledWith(
      'tenant-123', 'pyme', 'monthly', expect.any(Date), mockPrisma,
    )
    expect(mockSubscriptionsService.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        subscriptionId: 'sub-1',
        wompiTransactionId: 'txn-001',
        status: 'approved',
        processedAt: expect.any(Date),
      }),
      mockPrisma,
    )
    expect(mockSubscriptionsService.createSubscriptionInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        subscriptionId: 'sub-1',
        paymentId: 'pay-1',
        amount: 189000,
        planType: 'pyme',
        billing: 'monthly',
      }),
      mockPrisma,
    )
  })

  it('procesa webhook aunque DIAN del SaaS no esté configurado (no revienta)', async () => {
    mockWompiService.verifyWebhook.mockReturnValue(true)

    const sku = 'pyme_monthly_tenant-123'
    mockSubscriptionsService.activateSubscription.mockResolvedValue({ id: 'sub-1', tenantId: 'tenant-123' })
    mockSubscriptionsService.createPayment.mockResolvedValue({ id: 'pay-1' })
    mockSubscriptionsService.createSubscriptionInvoice.mockResolvedValue({ id: 'inv-1' })
    mockPrisma.payment.findUnique.mockResolvedValue(null)
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.tenant.findUnique.mockResolvedValue({ name: 'Test SAS', nit: '900999999' })
    mockPrisma.membership.findFirst.mockResolvedValue({ user: { email: 'admin@test.com', name: 'Admin' } })

    const body = {
      type: 'transaction.updated',
      data: {
        transaction: { id: 'txn-002', status: 'APPROVED', amount_in_cents: 18900000 },
        reference: sku,
      },
      signature: { checksum: 'abc', properties: [] },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockDianService.sendInvoice).not.toHaveBeenCalled()
  })

  it('procesa webhook con DIAN configurado y llama a sendInvoice', async () => {
    vi.stubEnv('SAAS_DIAN_NIT', '900123456')
    vi.stubEnv('SAAS_DIAN_SOFTWARE_ID', 'soft-123')
    vi.stubEnv('SAAS_DIAN_CERTIFICATE', 'dGVzdC1jZXJ0')

    mockWompiService.verifyWebhook.mockReturnValue(true)

    const sku = 'pyme_annual_tenant-456'
    const now = new Date()
    mockSubscriptionsService.activateSubscription.mockResolvedValue({ id: 'sub-2', tenantId: 'tenant-456' })
    mockSubscriptionsService.createPayment.mockResolvedValue({ id: 'pay-2' })
    mockSubscriptionsService.createSubscriptionInvoice.mockResolvedValue({
      id: 'inv-2',
      amount: 1701000,
      tax: 323190,
      total: 2024190,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      paidAt: now,
    })
    mockPrisma.payment.findUnique.mockResolvedValue(null)
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.tenant.findUnique.mockResolvedValue({ name: 'Otra SAS', nit: '900888888' })
    mockPrisma.membership.findFirst.mockResolvedValue({ user: { email: 'admin@otra.com', name: 'Admin' } })
    mockPrisma.subscriptionInvoice.findUnique.mockResolvedValue({ timeline: [] })
    mockDianService.sendInvoice.mockResolvedValue({
      success: true,
      cufe: 'CUFE-TEST-123',
      status: 'sent',
      message: 'Factura enviada a DIAN.',
    })

    const body = {
      type: 'transaction.updated',
      data: {
        transaction: { id: 'txn-003', status: 'APPROVED', amount_in_cents: 170100000 },
        reference: sku,
      },
      signature: { checksum: 'abc', properties: [] },
    }

    const result = await controller.wompiWebhook('valid-sig', body as any)

    expect(result).toEqual({ received: true })
    expect(mockDianService.sendInvoice).toHaveBeenCalledOnce()
    expect(mockPrisma.subscriptionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-2' },
      data: {
        cufe: 'CUFE-TEST-123',
        dianStatus: 'sent',
        xmlFileName: null,
        timeline: expect.arrayContaining([
          expect.objectContaining({ type: 'dian', action: 'send', cufe: 'CUFE-TEST-123', status: 'sent' }),
        ]),
      },
    })

    vi.unstubAllEnvs()
  })
})

describe('SubscriptionsController — exportData', () => {
  let controller: SubscriptionsController

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new SubscriptionsController(
      mockSubscriptionsService as any,
      mockWompiService as any,
      mockPrisma as any,
      mockNotificationService as any,
      mockDianService as any,
      { generateInvoicePdf: vi.fn().mockResolvedValue('tmp/test.pdf') } as any,
      { sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) } as any,
      { getAvailableCurrencies: vi.fn().mockReturnValue([]) } as any,
    )
  })

  it('rechaza sin tenantId', async () => {
    await expect(controller.exportData('', { sub: 'user-1', isSystemOwner: false } as any))
      .rejects.toThrow('Tenant requerido')
  })

  it('rechaza si el usuario no tiene membership ni es systemOwner', async () => {
    mockPrisma.membership.findUnique.mockResolvedValue(null)

    await expect(controller.exportData('tenant-1', { sub: 'user-1', isSystemOwner: false } as any))
      .rejects.toThrow('No tienes acceso')
  })

  it('retorna todos los datos con la estructura correcta', async () => {
    const authUser = { sub: 'user-1', isSystemOwner: false }
    mockPrisma.membership.findUnique.mockResolvedValue({ id: 'mem-1', role: 'Administrador' })
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'prod-1', name: 'Prod A' }])
    mockPrisma.thirdParty.findMany.mockResolvedValue([{ id: 'tp-1', name: 'Cliente X' }])
    mockPrisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1', number: 'F001', items: [] }])
    mockPrisma.purchase.findMany.mockResolvedValue([{ id: 'pur-1', items: [] }])
    mockPrisma.transaction.findMany.mockResolvedValue([{ id: 'txn-1' }])
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([{ id: 'ledger-1', lines: [] }])
    mockPrisma.tenant.findUnique.mockResolvedValue({ name: 'Mi Empresa', nit: '900123456', prefix: 'F' })
    mockPrisma.auditEvent.create.mockResolvedValue({})

    const result = await controller.exportData('tenant-1', authUser as any)

    expect(result).toHaveProperty('exportedAt')
    expect(result.tenant).toEqual({ name: 'Mi Empresa', nit: '900123456', prefix: 'F' })
    expect(result.products).toHaveLength(1)
    expect(result.thirdParties).toHaveLength(1)
    expect(result.invoices).toHaveLength(1)
    expect(result.purchases).toHaveLength(1)
    expect(result.transactions).toHaveLength(1)
    expect(result.ledgerEntries).toHaveLength(1)
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledOnce()
  })

  it('permite a systemOwner exportar sin membership', async () => {
    const authUser = { sub: 'admin-1', isSystemOwner: true }
    mockPrisma.membership.findUnique.mockResolvedValue(null)
    mockPrisma.product.findMany.mockResolvedValue([])
    mockPrisma.thirdParty.findMany.mockResolvedValue([])
    mockPrisma.invoice.findMany.mockResolvedValue([])
    mockPrisma.purchase.findMany.mockResolvedValue([])
    mockPrisma.transaction.findMany.mockResolvedValue([])
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([])
    mockPrisma.tenant.findUnique.mockResolvedValue({ name: 'Otra', nit: '900999999', prefix: 'X' })
    mockPrisma.auditEvent.create.mockResolvedValue({})

    const result = await controller.exportData('tenant-2', authUser as any)

    expect(result.tenant.name).toBe('Otra')
    expect(mockPrisma.membership.findUnique).toHaveBeenCalled()
    expect(result.products).toEqual([])
  })
})

describe('SubscriptionsController — deleteAccount', () => {
  let controller: SubscriptionsController

  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$transaction.mockImplementation((arg: any) => {
      if (Array.isArray(arg)) return Promise.resolve(arg.map(() => ({})))
      return Promise.resolve({})
    })
    mockPrisma.tenant.delete.mockResolvedValue({})
    mockPrisma.membership.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.auditEvent.create.mockResolvedValue({})
    controller = new SubscriptionsController(
      mockSubscriptionsService as any,
      mockWompiService as any,
      mockPrisma as any,
      mockNotificationService as any,
      mockDianService as any,
      { generateInvoicePdf: vi.fn().mockResolvedValue('tmp/test.pdf') } as any,
      { sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) } as any,
      { getAvailableCurrencies: vi.fn().mockReturnValue([]) } as any,
    )
  })

  it('rechaza sin tenantId', async () => {
    await expect(controller.deleteAccount('', { sub: 'user-1', isSystemOwner: false } as any))
      .rejects.toThrow('Tenant requerido')
  })

  it('rechaza si no tiene membership ni es systemOwner', async () => {
    mockPrisma.membership.findUnique.mockResolvedValue(null)

    await expect(controller.deleteAccount('tenant-1', { sub: 'user-1', isSystemOwner: false } as any))
      .rejects.toThrow('No tienes permisos')
  })

  it('rechaza si es la única empresa del usuario', async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({ id: 'mem-1', role: 'Administrador' })
    mockPrisma.membership.count.mockResolvedValue(0)

    await expect(controller.deleteAccount('tenant-1', { sub: 'user-1', isSystemOwner: false } as any))
      .rejects.toThrow('No puedes eliminar tu única empresa')
  })

  it('elimina tenant correctamente cuando tiene otras empresas', async () => {
    mockPrisma.membership.findUnique.mockResolvedValue({ id: 'mem-1', role: 'Administrador' })
    mockPrisma.membership.count.mockResolvedValue(2)

    const result = await controller.deleteAccount('tenant-1', { sub: 'user-1', isSystemOwner: false } as any)

    expect(mockPrisma.$transaction).toHaveBeenCalled()
    expect(mockPrisma.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant-1' } })
    expect(result).toEqual({ ok: true, message: expect.stringContaining('eliminada') })
  })

  it('permite a systemOwner eliminar sin restricción de membresías', async () => {
    mockPrisma.membership.findUnique.mockResolvedValue(null)

    const result = await controller.deleteAccount('tenant-1', { sub: 'admin-1', isSystemOwner: true } as any)

    expect(mockPrisma.$transaction).toHaveBeenCalled()
    expect(mockPrisma.tenant.delete).toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})
