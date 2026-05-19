import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common'
import { DianService } from './dian.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('dian')
@UseGuards(AuthGuard, PermissionsGuard)
export class DianController {
  constructor(private readonly dianService: DianService) {}

  /**
   * Envía una factura a la DIAN
   */
  @Post('invoices/:id/send')
  @Permissions('manage_billing')
  async sendInvoice(
    @TenantId() tenantId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.dianService.sendInvoiceToDian(tenantId, invoiceId)
  }

  /**
   * Consulta el estado de una factura en DIAN
   */
  @Get('invoices/:id/status')
  @Permissions('view_billing')
  async checkStatus(
    @TenantId() tenantId: string,
    @Param('id') invoiceId: string,
  ) {
    return this.dianService.checkInvoiceStatusInDian(tenantId, invoiceId)
  }

  /**
   * Valida la configuración DIAN del tenant
   */
  @Get('config/validate')
  @Permissions('view_billing')
  async validateConfig(@TenantId() tenantId: string) {
    return this.dianService.validateConfig(tenantId)
  }

  /**
   * Obtiene la configuración DIAN del tenant
   */
  @Get('config')
  @Permissions('view_billing')
  async getConfig(@TenantId() tenantId: string) {
    return this.dianService.getConfig(tenantId)
  }

  /**
   * Actualiza configuración DIAN del tenant
   */
  @Post('config')
  @Permissions('manage_billing')
  async updateConfig(
    @TenantId() tenantId: string,
    @Body() config: {
      dianEnvironment?: string
      dianSoftwareId?: string
      dianSoftwarePin?: string
      dianNit?: string
      dianTestSetId?: string
      dianCertificate?: string
      dianCertificatePassword?: string
      invoiceResolution?: string
      resolutionFrom?: string
      resolutionTo?: string
      dianOperationCode?: string
    },
  ) {
    // Solo actualizar campos DIAN permitidos
    const updateData: any = {}
    const allowedFields = [
      'dianEnvironment', 'dianSoftwareId', 'dianSoftwarePin',
      'dianNit', 'dianTestSetId', 'dianCertificate', 'dianCertificatePassword',
      'invoiceResolution', 'resolutionFrom', 'resolutionTo', 'dianOperationCode'
    ]
    
    for (const field of allowedFields) {
      if (config[field as keyof typeof config] !== undefined) {
        const value = config[field as keyof typeof config]
        if (field === 'resolutionFrom' || field === 'resolutionTo') {
          updateData[field] = value ? new Date(String(value)) : null
        } else {
          updateData[field] = value
        }
      }
    }

    const tenant = await this.dianService.updateConfig(tenantId, updateData)
    return { success: true, updated: Object.keys(updateData), tenant }
  }
}
