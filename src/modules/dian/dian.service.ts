import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InvoiceStatus, Prisma } from '@prisma/client'
import * as soap from 'soap'
import * as forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import { createHash, randomUUID } from 'crypto'
import { PrismaService } from '../database/prisma.service'
import { InvoiceMailerService } from '../invoices/invoice-mailer.service'

export interface DianInvoicePayload {
  invoiceId: string
  tenantId: string
  number: string
  issuedAt: Date
  dueAt?: Date | null
  subtotal: number
  taxTotal: number
  total: number
  client: {
    name: string
    nit: string
    email: string
  }
  items: Array<{
    productName: string
    quantity: number
    unitPrice: number
    taxRate: number
    subtotal: number
    taxAmount: number
  }>
}

export interface DianResponse {
  success: boolean
  cufe?: string
  qrCode?: string
  status: 'pending' | 'sent' | 'accepted' | 'rejected'
  message: string
  dianTrackingId?: string
  xmlFileName?: string
  errors?: string[]
}

type DianEnvironment = 'test' | 'production'

type TenantDianConfig = Prisma.TenantGetPayload<{
  select: {
    id: true
    name: true
    prefix: true
    nit: true
    invoicePrefix: true
    lastInvoiceNumber: true
    invoiceResolution: true
    resolutionFrom: true
    resolutionTo: true
    dianEnvironment: true
    dianTestSetId: true
    dianSoftwareId: true
    dianSoftwarePin: true
    dianCertificate: true
    dianCertificatePassword: true
    dianNit: true
    dianOperationCode: true
  }
}>

type TransmissionEvent = {
  type: 'dian'
  action: 'send' | 'status'
  at: string
  status: DianResponse['status']
  message: string
  cufe?: string
  trackId?: string
  xmlFileName?: string
  response?: Record<string, unknown>
}

type CertificateMaterial = {
  privateKeyPem: string
  certificatePem: string
}

const DIAN_WSDL_BY_ENV: Record<DianEnvironment, string> = {
  test: process.env.DIAN_TEST_WSDL_URL || 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl',
  production: process.env.DIAN_PROD_WSDL_URL || 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl',
}

const DIAN_ENDPOINT_BY_ENV: Record<DianEnvironment, string> = {
  test: process.env.DIAN_TEST_ENDPOINT_URL || 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
  production: process.env.DIAN_PROD_ENDPOINT_URL || 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function digitsOnly(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '')
}

function formatNumber(value: number) {
  return Number(value || 0).toFixed(2)
}

function formatDate(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTime(value: Date) {
  const hours = String(value.getUTCHours()).padStart(2, '0')
  const minutes = String(value.getUTCMinutes()).padStart(2, '0')
  const seconds = String(value.getUTCSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}-05:00`
}

function toBase64(input: string) {
  return Buffer.from(input, 'utf8').toString('base64')
}

function stripDataUrl(input: string) {
  return String(input || '')
    .replace(/^data:.*?;base64,/, '')
    .replace(/\s+/g, '')
    .trim()
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function parseTimeline(value: unknown): TransmissionEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(Boolean) as TransmissionEvent[]
}

function buildSoapAction(action: string) {
  return `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`
}

function normalizeEnvironment(value: string | null | undefined): DianEnvironment {
  return value === 'production' ? 'production' : 'test'
}

function resolveIdentificationType(nit: string) {
  return digitsOnly(nit).length > 10 ? '31' : '31'
}

function resolvePaymentMeans() {
  return '2'
}

function resolveTaxSubtotal(rate: number, taxableAmount: number, totalTax: number) {
  return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">${formatNumber(taxableAmount)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">${formatNumber(totalTax)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${Number(rate || 0).toFixed(2)}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`
}

function buildInvoiceLines(invoice: DianInvoicePayload) {
  return invoice.items
    .map((item, index) => {
      const lineTaxRate = Number(item.taxRate || 0)
      const lineSubtotal = Number(item.subtotal || 0)
      const lineTax = Number(item.taxAmount || 0)
      return `
    <cac:InvoiceLine>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="NIU">${Number(item.quantity || 0)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="COP">${formatNumber(lineSubtotal)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="COP">${formatNumber(lineTax)}</cbc:TaxAmount>
        ${resolveTaxSubtotal(lineTaxRate, lineSubtotal, lineTax)}
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description>${escapeXml(item.productName)}</cbc:Description>
        <cac:SellersItemIdentification>
          <cbc:ID>${escapeXml(index + 1)}</cbc:ID>
        </cac:SellersItemIdentification>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="COP">${formatNumber(Number(item.unitPrice || 0))}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`
    })
    .join('\n')
}

function buildCufe(invoice: DianInvoicePayload, tenant: TenantDianConfig) {
  const issueDate = formatDate(invoice.issuedAt).replace(/-/g, '')
  const issueTime = formatTime(invoice.issuedAt).replace(/:/g, '').replace('-05:00', '')
  const subtotal = formatNumber(invoice.subtotal).replace('.', '')
  const taxTotal = formatNumber(invoice.taxTotal).replace('.', '')
  const total = formatNumber(invoice.total).replace('.', '')
  const nit = digitsOnly(tenant.dianNit || tenant.nit)
  const customerNit = digitsOnly(invoice.client.nit)
  const taxCode = '01'
  const taxValue = formatNumber(invoice.taxTotal).replace('.', '')
  const technicalKey = String(tenant.dianSoftwarePin || tenant.dianSoftwareId || '').trim()
  const payload = [
    invoice.number,
    issueDate,
    issueTime,
    total,
    taxCode,
    taxValue,
    taxCode,
    '0',
    taxCode,
    '0',
    subtotal,
    nit,
    resolveIdentificationType(invoice.client.nit),
    customerNit,
    technicalKey,
  ].join('')

  return createHash('sha384').update(payload).digest('hex').toUpperCase()
}

function extractCertificatePem(raw: string, password?: string | null) {
  const cleaned = stripDataUrl(raw)
  if (!cleaned) {
    throw new BadRequestException('El certificado DIAN está vacío.')
  }

  if (cleaned.includes('BEGIN CERTIFICATE') && cleaned.includes('BEGIN PRIVATE KEY')) {
    const certMatch = cleaned.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
    const keyMatch = cleaned.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/)
    if (!certMatch || !keyMatch) {
      throw new BadRequestException('No se pudo leer el certificado PEM.')
    }

    return {
      privateKeyPem: keyMatch[0],
      certificatePem: certMatch[0],
    }
  }

  try {
    const p12Der = forge.util.decode64(cleaned)
    const asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password || undefined)
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
    const keys = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || []
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const certs = certBags[forge.pki.oids.certBag] || []
    const privateKey = keys[0]?.key
    const cert = certs[0]?.cert

    if (!privateKey || !cert) {
      throw new Error('Certificado o llave no encontrados en el archivo P12.')
    }

    const privateKeyPem = forge.pki.privateKeyToPem(privateKey)
    const certificatePem = forge.pki.certificateToPem(cert)
    return { privateKeyPem, certificatePem }
  } catch (error) {
    throw new BadRequestException('No se pudo interpretar el certificado DIAN. Sube un .p12 o .pfx válido.')
  }
}

function buildSignedInvoiceXml(invoice: DianInvoicePayload, tenant: TenantDianConfig) {
  const issueDate = formatDate(invoice.issuedAt)
  const issueTime = formatTime(invoice.issuedAt)
  const cufe = buildCufe(invoice, tenant)
  const executionId = normalizeEnvironment(tenant.dianEnvironment) === 'production' ? '1' : '2'
  const supplierNit = digitsOnly(tenant.dianNit || tenant.nit)
  const customerNit = digitsOnly(invoice.client.nit)
  const customerAdditionalAccountId = resolveIdentificationType(invoice.client.nit)
  const invoiceTypeCode = '01'
  const taxTotal = formatNumber(invoice.taxTotal)
  const subtotal = formatNumber(invoice.subtotal)
  const total = formatNumber(invoice.total)

  const baseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>${executionId}</cbc:ProfileExecutionID>
  <cbc:ID>${escapeXml(invoice.number)}</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384" schemeID="${executionId}">${cufe}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${invoice.items.length}</cbc:LineCountNumeric>
  <cbc:Note>${escapeXml(`Factura emitida por ${tenant.name}`)}</cbc:Note>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${escapeXml(tenant.name)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="31" schemeName="NIT">${supplierNit}</cbc:CompanyID>
        <cbc:TaxLevelCode>O-13</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${escapeXml(invoice.client.name)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${customerAdditionalAccountId}" schemeName="NIT">${customerNit}</cbc:CompanyID>
        <cbc:TaxLevelCode>O-99</cbc:TaxLevelCode>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>${resolvePaymentMeans()}</cbc:ID>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${taxTotal}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">${subtotal}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${taxTotal}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>${Number(invoice.items.reduce((max, item) => Math.max(max, Number(item.taxRate || 0)), 0)).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${buildInvoiceLines(invoice)}
</Invoice>`

  return { baseXml, cufe }
}

function signInvoiceXml(baseXml: string, certificate: CertificateMaterial) {
  const signer = new SignedXml({
    privateKey: certificate.privateKeyPem,
    publicCert: certificate.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  })

  signer.addReference({
    xpath: "/*[local-name(.)='Invoice']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  })

  signer.computeSignature(baseXml)
  const signatureXml = signer.getSignatureXml()
  return baseXml.replace('</ext:ExtensionContent>', `${signatureXml}</ext:ExtensionContent>`)
}

function buildQrCodeUrl(cufe: string) {
  return `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(cufe)}`
}

@Injectable()
export class DianService {
  private readonly logger = new Logger(DianService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceMailer: InvoiceMailerService
  ) {}

  async sendInvoice(invoice: DianInvoicePayload): Promise<DianResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: invoice.tenantId },
      select: {
        id: true,
        name: true,
        prefix: true,
        nit: true,
        invoicePrefix: true,
        lastInvoiceNumber: true,
        invoiceResolution: true,
        resolutionFrom: true,
        resolutionTo: true,
        dianEnvironment: true,
        dianTestSetId: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianCertificate: true,
        dianCertificatePassword: true,
        dianNit: true,
        dianOperationCode: true,
      } satisfies Prisma.TenantSelect,
    }) as TenantDianConfig | null

    if (!tenant) {
      throw new BadRequestException('Tenant no encontrado')
    }

    const validation = await this.validateConfig(invoice.tenantId)
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        message: 'La configuración DIAN está incompleta.',
        errors: validation.errors,
      }
    }

    const { baseXml, cufe } = buildSignedInvoiceXml(invoice, tenant)
    const certificate = extractCertificatePem(tenant.dianCertificate || '', tenant.dianCertificatePassword || '')
    const signedXml = signInvoiceXml(baseXml, certificate)
    const xmlFileName = `${invoice.number.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`
    const contentFile = Buffer.from(signedXml, 'utf8').toString('base64')
    const environment = normalizeEnvironment(tenant.dianEnvironment)
    const endpoint = DIAN_ENDPOINT_BY_ENV[environment]
    const wsdl = DIAN_WSDL_BY_ENV[environment]
    const soapAction = environment === 'test' ? 'SendTestSetAsync' : 'SendBillSync'

    try {
      const client = await soap.createClientAsync(wsdl, {
        endpoint,
        forceSoap12Headers: true,
      })

      client.setSecurity(new soap.WSSecurityCert(
        certificate.privateKeyPem,
        certificate.certificatePem,
        tenant.dianCertificatePassword || '',
        {
          hasTimeStamp: true,
          signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
          digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
          signerOptions: {
            prefix: 'ds',
          },
        },
      ))

      client.addSoapHeader(
        {
          'wsa:Action': buildSoapAction(soapAction),
          'wsa:To': endpoint,
          'wsa:MessageID': `urn:uuid:${randomUUID()}`,
        },
        undefined,
        'wsa',
        'http://www.w3.org/2005/08/addressing',
      )

      const request = environment === 'test'
        ? {
            fileName: xmlFileName,
            contentFile,
            testSetId: tenant.dianTestSetId,
          }
        : {
            fileName: xmlFileName,
            contentFile,
          }

      const method = environment === 'test' ? 'SendTestSetAsync' : 'SendBillSync'
      const [soapResult] = await client[`${method}Async`](request)
      const result = soapResult?.[`${method}Result`] || soapResult
      const trackId = result?.ZipKey || result?.XmlDocumentKey || result?.TrackId || null
      const accepted = Boolean(result?.IsValid) || Boolean(trackId)

      await this.appendDianTimeline(invoice.tenantId, invoice.invoiceId, {
        type: 'dian',
        action: 'send',
        at: new Date().toISOString(),
        status: accepted ? 'sent' : 'rejected',
        message: accepted
          ? 'Factura transmitida a DIAN.'
          : 'DIAN devolvió un rechazo o no generó seguimiento.',
        cufe,
        trackId: trackId || undefined,
        xmlFileName,
        response: safeJson(result ?? {}),
      })

      await this.prisma.invoice.update({
        where: { id: invoice.invoiceId },
        data: {
          status: accepted ? InvoiceStatus.sent : InvoiceStatus.emitted,
        },
      })

      if (accepted) {
        this.invoiceMailer.sendInvoice({
          tenantId: invoice.tenantId,
          invoiceId: invoice.invoiceId,
          clientEmail: invoice.client.email,
          clientName: invoice.client.name,
          invoiceNumber: invoice.number,
          cufe,
          total: invoice.total,
          xmlFileName,
          xmlBase64: contentFile,
        }).catch(err => this.logger.error('Error in background invoice mailing', err));
      }

      return {
        success: accepted,
        cufe,
        qrCode: buildQrCodeUrl(cufe),
        status: accepted ? 'sent' : 'rejected',
        message: accepted
          ? environment === 'test'
            ? 'Factura enviada a DIAN en habilitación.'
            : 'Factura enviada a DIAN.'
          : 'La transmisión fue rechazada por DIAN.',
        dianTrackingId: trackId || undefined,
        xmlFileName,
        errors: accepted ? undefined : this.extractSoapErrors(result),
      }
    } catch (error) {
      this.logger.error(`Error enviando factura ${invoice.number} a DIAN`, error instanceof Error ? error.stack : undefined)

      await this.appendDianTimeline(invoice.tenantId, invoice.invoiceId, {
        type: 'dian',
        action: 'send',
        at: new Date().toISOString(),
        status: 'rejected',
        message: error instanceof Error ? error.message : 'Error desconocido al transmitir a DIAN.',
        cufe,
        xmlFileName,
        response: { error: error instanceof Error ? error.message : String(error) },
      })

      return {
        success: false,
        status: 'rejected',
        cufe,
        qrCode: buildQrCodeUrl(cufe),
        message: error instanceof Error ? error.message : 'No se pudo transmitir la factura a DIAN.',
        xmlFileName,
        errors: [error instanceof Error ? error.message : 'DIAN_TRANSMISSION_FAILED'],
      }
    }
  }

  async checkInvoiceStatus(cufe: string, tenantId: string): Promise<DianResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dianEnvironment: true,
        dianCertificate: true,
        dianCertificatePassword: true,
      } satisfies Prisma.TenantSelect,
    })

    if (!tenant) {
      throw new BadRequestException('Tenant no encontrado')
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId },
      select: { id: true, number: true, timeline: true } as any,
    }) as unknown as Array<{ id: string; number: string; timeline?: unknown }>

    const invoice = invoices.find((row) => {
      const timeline = parseTimeline(row.timeline)
      return timeline.some((event) => event.type === 'dian' && event.cufe === cufe)
    }) || null

    if (!invoice) {
      return {
        success: false,
        status: 'rejected',
        message: 'No se encontró una factura asociada a ese CUFE.',
        errors: ['INVOICE_NOT_FOUND'],
      }
    }

    const timeline = parseTimeline(invoice.timeline)
    const lastDianEvent = [...timeline].reverse().find((event) => event.type === 'dian')
    const trackId = lastDianEvent?.trackId

    if (!trackId) {
      return {
        success: true,
        cufe,
        status: 'pending',
        message: 'La factura todavía no tiene trackId de seguimiento DIAN.',
      }
    }

    const environment = normalizeEnvironment(tenant.dianEnvironment)
    const endpoint = DIAN_ENDPOINT_BY_ENV[environment]
    const wsdl = DIAN_WSDL_BY_ENV[environment]

    try {
      const client = await soap.createClientAsync(wsdl, {
        endpoint,
        forceSoap12Headers: true,
      })

      if (tenant.dianCertificate && tenant.dianCertificatePassword) {
        const certificate = extractCertificatePem(tenant.dianCertificate, tenant.dianCertificatePassword)
        client.setSecurity(new soap.WSSecurityCert(
          certificate.privateKeyPem,
          certificate.certificatePem,
          tenant.dianCertificatePassword,
          {
            hasTimeStamp: true,
            signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
            digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
          },
        ))
      }

      client.addSoapHeader(
        {
          'wsa:Action': buildSoapAction('GetStatus'),
          'wsa:To': endpoint,
          'wsa:MessageID': `urn:uuid:${randomUUID()}`,
        },
        undefined,
        'wsa',
        'http://www.w3.org/2005/08/addressing',
      )

      const [soapResult] = await client.GetStatusAsync({ trackId })
      const result = soapResult?.GetStatusResult || soapResult
      const accepted = Boolean(result?.IsValid)
      const status: DianResponse['status'] = accepted ? 'accepted' : 'pending'

      await this.appendDianTimeline(tenantId, invoice.id, {
        type: 'dian',
        action: 'status',
        at: new Date().toISOString(),
        status,
        message: result?.StatusMessage || result?.StatusDescription || 'Consulta de estado DIAN procesada.',
        cufe,
        trackId,
        response: safeJson(result ?? {}),
      })

      if (accepted) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.accepted },
        })
      }

      return {
        success: true,
        cufe,
        status,
        message: result?.StatusMessage || result?.StatusDescription || 'Estado consultado correctamente.',
        dianTrackingId: trackId,
        errors: this.extractSoapErrors(result),
      }
    } catch (error) {
      return {
        success: false,
        cufe,
        status: 'pending',
        message: error instanceof Error ? error.message : 'No se pudo consultar el estado DIAN.',
        errors: [error instanceof Error ? error.message : 'DIAN_STATUS_ERROR'],
      }
    }
  }

  async validateConfig(tenantId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        nit: true,
        invoiceResolution: true,
        resolutionFrom: true,
        resolutionTo: true,
        dianEnvironment: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianNit: true,
        dianCertificate: true,
        dianCertificatePassword: true,
        dianTestSetId: true,
      } satisfies Prisma.TenantSelect,
    })

    const errors: string[] = []
    const warnings: string[] = []

    if (!tenant) {
      return { valid: false, errors: ['Tenant no encontrado'], warnings }
    }

    if (!tenant.invoiceResolution) errors.push('Falta invoiceResolution.')
    if (!tenant.resolutionFrom || !tenant.resolutionTo) errors.push('Falta el rango de vigencia de la resolución.')
    if (!tenant.dianNit) errors.push('Falta dianNit.')
    if (!tenant.dianSoftwareId) errors.push('Falta dianSoftwareId.')
    if (!tenant.dianSoftwarePin) errors.push('Falta dianSoftwarePin.')
    if (!tenant.dianCertificate) errors.push('Falta cargar el certificado digital .p12/.pfx.')
    if (!tenant.dianCertificatePassword) errors.push('Falta la contraseña del certificado digital.')

    if (normalizeEnvironment(tenant.dianEnvironment) === 'test' && !tenant.dianTestSetId) {
      warnings.push('En pruebas conviene cargar el testSetId para validar la habilitación.')
    }

    if (normalizeEnvironment(tenant.dianEnvironment) === 'production' && !tenant.dianCertificate) {
      errors.push('En producción el certificado digital es obligatorio.')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  generateUblXml(invoice: DianInvoicePayload, tenant: TenantDianConfig): string {
    return buildSignedInvoiceXml(invoice, tenant).baseXml
  }

  async sendInvoiceToDian(tenantId: string, invoiceId: string): Promise<DianResponse> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { client: true, items: true },
    })

    if (!invoice) {
      return {
        success: false,
        status: 'rejected',
        message: 'Factura no encontrada',
        errors: ['INVOICE_NOT_FOUND'],
      }
    }

    if (!invoice.client) {
      return {
        success: false,
        status: 'rejected',
        message: 'La factura no tiene cliente asociado',
        errors: ['CLIENT_NOT_FOUND'],
      }
    }

    const payload: DianInvoicePayload = {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      subtotal: Number(invoice.subtotal),
      taxTotal: Number(invoice.taxTotal),
      total: Number(invoice.total),
      client: {
        name: invoice.client.name,
        nit: invoice.client.nit,
        email: invoice.client.email,
      },
      items: invoice.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate),
        subtotal: Number(item.subtotal),
        taxAmount: Number(item.taxAmount),
      })),
    }

    return this.sendInvoice(payload)
  }

  async checkInvoiceStatusInDian(tenantId: string, invoiceId: string): Promise<DianResponse> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { number: true, timeline: true } as any,
    }) as { number: string; timeline?: unknown } | null

    if (!invoice) {
      return {
        success: false,
        status: 'rejected',
        message: 'Factura no encontrada',
        errors: ['INVOICE_NOT_FOUND'],
      }
    }

    const timeline = parseTimeline(invoice.timeline)
    const lastDianEvent = [...timeline].reverse().find((event) => event.type === 'dian')

    if (!lastDianEvent?.cufe) {
      return {
        success: true,
        status: 'pending',
        message: 'Factura aún no ha sido enviada a DIAN',
      }
    }

    return this.checkInvoiceStatus(lastDianEvent.cufe, tenantId)
  }

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dianEnvironment: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianNit: true,
        dianTestSetId: true,
        dianCertificate: true,
        dianCertificatePassword: true,
        invoiceResolution: true,
        resolutionFrom: true,
        resolutionTo: true,
        dianOperationCode: true,
      } satisfies Prisma.TenantSelect,
    })

    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado')
    }

    return {
      dianEnvironment: tenant.dianEnvironment,
      dianSoftwareId: tenant.dianSoftwareId,
      dianSoftwarePin: tenant.dianSoftwarePin,
      dianNit: tenant.dianNit,
      dianTestSetId: tenant.dianTestSetId,
      invoiceResolution: tenant.invoiceResolution,
      resolutionFrom: tenant.resolutionFrom,
      resolutionTo: tenant.resolutionTo,
      dianOperationCode: tenant.dianOperationCode,
      hasCertificate: Boolean(tenant.dianCertificate),
    }
  }

  async updateConfig(tenantId: string, data: any) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    })
  }

  private async appendDianTimeline(tenantId: string, invoiceId: string, event: TransmissionEvent) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { timeline: true } as any,
    }) as { timeline?: unknown } | null

    const timeline = parseTimeline(invoice?.timeline)
    timeline.push(event)

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        timeline: timeline as unknown as Prisma.InputJsonValue,
      },
    })
  }

  private extractSoapErrors(result: any): string[] {
    const errorMessage = result?.ErrorMessage
    if (Array.isArray(errorMessage)) {
      return errorMessage.filter(Boolean).map(String)
    }
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return [errorMessage]
    }
    if (typeof result?.StatusMessage === 'string' && result.StatusMessage.trim()) {
      return [result.StatusMessage]
    }
    if (typeof result?.StatusDescription === 'string' && result.StatusDescription.trim()) {
      return [result.StatusDescription]
    }
    return []
  }
}
