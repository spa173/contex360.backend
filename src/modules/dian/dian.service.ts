import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

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
  errors?: string[]
}

@Injectable()
export class DianService {
  private readonly logger = new Logger(DianService.name)
  
  // URLs de la DIAN (Habilitación Facturación Electrónica)
  private readonly DIAN_TEST_URL = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc'
  private readonly DIAN_PROD_URL = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc'

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Envía una factura a la DIAN
   * En una implementación real, esto firmaría el XML y llamaría al servicio SOAP de DIAN
   */
  async sendInvoice(invoice: DianInvoicePayload): Promise<DianResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: invoice.tenantId },
      select: {
        dianEnvironment: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianNit: true,
        dianTestSetId: true,
      } as any,
    }) as any

    if (!tenant) {
      throw new BadRequestException('Tenant no encontrado')
    }

    // Validar configuración DIAN
    if (!tenant.dianSoftwareId || !tenant.dianNit) {
      return {
        success: false,
        status: 'rejected',
        message: 'Configuración DIAN incompleta. Falta software ID o NIT.',
        errors: ['MISSING_DIAN_CONFIG'],
      }
    }

    // En ambiente de pruebas, simular respuesta exitosa
    if (tenant.dianEnvironment === 'test') {
      this.logger.log(`[DIAN TEST] Simulando envío de factura ${invoice.number}`)
      
      // Generar CUFE simulado (en producción viene de DIAN)
      const cufe = this.generateMockCufe(invoice)
      
      return {
        success: true,
        cufe,
        qrCode: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
        status: 'accepted',
        message: 'Factura aceptada por DIAN (ambiente de pruebas)',
        dianTrackingId: `TEST-${Date.now()}`,
      }
    }

    // TODO: Implementar envío real a DIAN en producción
    // 1. Generar XML UBL 2.1
    // 2. Firmar con certificado digital
    // 3. Enviar al servicio SOAP de DIAN
    // 4. Procesar respuesta
    
    this.logger.warn('Envío a DIAN en producción no implementado completamente')
    
    return {
      success: false,
      status: 'rejected',
      message: 'Envío a producción no implementado',
      errors: ['NOT_IMPLEMENTED'],
    }
  }

  /**
   * Consulta el estado de una factura en DIAN
   */
  async checkInvoiceStatus(cufe: string, tenantId: string): Promise<DianResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { dianEnvironment: true } as any,
    }) as any

    if (tenant?.dianEnvironment === 'test') {
      // En pruebas, simular que la factura está aceptada
      return {
        success: true,
        cufe,
        status: 'accepted',
        message: 'Factura en estado aceptado',
      }
    }

    // TODO: Consultar estado real en DIAN
    return {
      success: true,
      cufe,
      status: 'pending',
      message: 'Estado pendiente de consulta',
    }
  }

  /**
   * Valida la configuración DIAN de un tenant
   */
  async validateConfig(tenantId: string): Promise<{
    valid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dianEnvironment: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianNit: true,
        dianCertificate: true,
        dianTestSetId: true,
        invoiceResolution: true,
        resolutionFrom: true,
        resolutionTo: true,
      } as any,
    }) as any

    const errors: string[] = []
    const warnings: string[] = []

    if (!tenant) {
      errors.push('Tenant no encontrado')
      return { valid: false, errors, warnings }
    }

    if (!tenant.dianSoftwareId) errors.push('Falta dianSoftwareId')
    if (!tenant.dianNit) errors.push('Falta dianNit (NIT para envío DIAN)')
    if (!tenant.invoiceResolution) errors.push('Falta resolución de facturación')
    if (!tenant.resolutionFrom || !tenant.resolutionTo) {
      errors.push('Falta rango de fechas de resolución')
    }

    if (!tenant.dianCertificate && tenant.dianEnvironment === 'production') {
      errors.push('Falta certificado digital para ambiente de producción')
    }

    if (!tenant.dianTestSetId && tenant.dianEnvironment === 'test') {
      warnings.push('No se ha configurado un TestSetId para pruebas')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Genera el XML UBL 2.1 para una factura (estructura básica)
   */
  generateUblXml(invoice: DianInvoicePayload, tenant: any): string {
    // NOTA: Esta es una estructura simplificada. En producción se necesita
    // el XML completo según especificación DIAN con todos los campos requeridos
    
    const issueDate = invoice.issuedAt.toISOString().split('T')[0]
    const issueTime = invoice.issuedAt.toISOString().split('T')[1].substring(0, 8)
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"
         xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"
         xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:AuthorizationProvider>
              <sts:AuthorizationProviderID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="195" schemeName="NIT">800197268</sts:AuthorizationProviderID>
            </sts:AuthorizationProvider>
            <sts:AuthorizationPeriod>
              <cbc:StartDate>${tenant.resolutionFrom?.toISOString().split('T')[0] || issueDate}</cbc:StartDate>
              <cbc:EndDate>${tenant.resolutionTo?.toISOString().split('T')[0] || issueDate}</cbc:EndDate>
            </sts:AuthorizationPeriod>
            <sts:AuthorizedInvoices>
              <sts:Prefix>${tenant.invoicePrefix || 'FV'}</sts:Prefix>
              <sts:From>${tenant.lastInvoiceNumber || 1}</sts:From>
              <sts:To>999999</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ID>${invoice.number}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:Note>${invoice.items.length} items</cbc:Note>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${invoice.items.length}</cbc:LineCountNumeric>
  <!-- Datos del emisor (Tenant) y adquiriente (Client) omitidos para brevedad -->
  <!-- Totales y líneas de factura omitidos -->
</Invoice>`
  }

  /**
   * Genera un CUFE simulado para ambiente de pruebas
   */
  private generateMockCufe(invoice: DianInvoicePayload): string {
    // CUFE real se calcula con hash SHA384 de campos específicos
    // Este es un mock para pruebas
    const data = `${invoice.number}${invoice.issuedAt.toISOString()}${invoice.total}`
    return Buffer.from(data).toString('base64').substring(0, 96).toUpperCase()
  }

  /**
   * Envía una factura existente a DIAN (wrapper con lookup)
   */
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
      }
    }

    if (!invoice.client) {
      return {
        success: false,
        status: 'rejected',
        message: 'La factura no tiene cliente asociado',
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
      items: invoice.items.map(item => ({
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

  /**
   * Consulta estado de factura en DIAN (wrapper con lookup)
   */
  async checkInvoiceStatusInDian(tenantId: string, invoiceId: string): Promise<DianResponse> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { number: true, timeline: true } as any,
    }) as any

    if (!invoice) {
      return {
        success: false,
        status: 'rejected',
        message: 'Factura no encontrada',
      }
    }

    // Extraer CUFE del timeline si existe
    const timeline = (invoice.timeline || []) as Array<{ cufe?: string; status?: string }>
    const dianEvent = timeline.find(e => e.cufe)
    
    if (!dianEvent?.cufe) {
      return {
        success: true,
        status: 'pending',
        message: 'Factura aún no ha sido enviada a DIAN',
      }
    }

    return this.checkInvoiceStatus(dianEvent.cufe, tenantId)
  }

  /**
   * Obtiene la configuración DIAN de un tenant
   */
  async getConfig(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        dianEnvironment: true,
        dianSoftwareId: true,
        dianSoftwarePin: true,
        dianNit: true,
        dianTestSetId: true,
        dianCertificate: true,
        dianCertificatePassword: true,
      } as any,
    })
  }

  /**
   * Actualiza la configuración DIAN de un tenant
   */
  async updateConfig(tenantId: string, data: any) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    })
  }
}
