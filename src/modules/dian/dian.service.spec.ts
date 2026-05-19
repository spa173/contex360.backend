import { describe, expect, it, vi } from 'vitest'
import { DianService } from './dian.service'

const prismaMock = {
  tenant: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  invoice: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
} as any

const TEST_CERT_PASSWORD = 'test-cert-password-placeholder'

describe('DianService', () => {
  it('detecta configuración incompleta', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      name: 'Contex',
      nit: '900123456',
      invoiceResolution: null,
      resolutionFrom: null,
      resolutionTo: null,
      dianEnvironment: 'test',
      dianSoftwareId: null,
      dianSoftwarePin: null,
      dianCertificate: null,
      dianCertificatePassword: null,
      dianNit: null,
      dianTestSetId: null,
      dianOperationCode: '10',
    })

    const service = new DianService(prismaMock)
    const result = await service.validateConfig('tenant-1')

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Falta invoiceResolution.')
    expect(result.errors).toContain('Falta cargar el certificado digital .p12/.pfx.')
  })

  it('genera XML UBL con CUFE y numero de factura', () => {
    const service = new DianService(prismaMock)
    const xml = service.generateUblXml(
      {
        invoiceId: 'inv-1',
        tenantId: 'tenant-1',
        number: 'FV-000001',
        issuedAt: new Date('2026-05-19T10:30:00Z'),
        subtotal: 100000,
        taxTotal: 19000,
        total: 119000,
        client: {
          name: 'Cliente SAS',
          nit: '900999999',
          email: 'cliente@demo.com',
        },
        items: [
          {
            productName: 'Servicio',
            quantity: 1,
            unitPrice: 100000,
            taxRate: 19,
            subtotal: 100000,
            taxAmount: 19000,
          },
        ],
      },
      {
        id: 'tenant-1',
        name: 'Contex 360 SAS',
        prefix: 'CTX',
        nit: '900123456',
        invoicePrefix: 'FV',
        lastInvoiceNumber: 1,
        invoiceResolution: '18764000000123',
        resolutionFrom: new Date('2026-01-01T00:00:00Z'),
        resolutionTo: new Date('2026-12-31T00:00:00Z'),
        dianEnvironment: 'test',
        dianTestSetId: 'TEST-123',
        dianSoftwareId: 'soft-123',
        dianSoftwarePin: '12345',
        dianCertificate: 'dGVzdA==',
        dianCertificatePassword: TEST_CERT_PASSWORD,
        dianNit: '900123456',
        dianOperationCode: '10',
      },
    )

    expect(xml).toContain('<cbc:ID>FV-000001</cbc:ID>')
    expect(xml).toContain('CUFE-SHA384')
  })
})
