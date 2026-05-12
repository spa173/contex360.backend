import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { AdminGuard } from '../auth/admin.guard'
import { AuthenticatedRequest } from '../auth/auth.types'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getSystemStats()
  }

  @Get('tenants')
  getTenants() {
    return this.adminService.getAllTenants()
  }

  @Get('users')
  getUsers() {
    return this.adminService.getAllUsers()
  }

  @Get('audit-logs')
  getAuditLogs() {
    return this.adminService.getGlobalAuditLogs()
  }

  @Get('compliance')
  getCompliance() {
    return this.adminService.getComplianceDashboard()
  }

  @Post('compliance/access-review')
  runAccessReview(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    return this.adminService.runAccessReview('manual', request.authUser.sub)
  }

  @Delete('users/:id/data')
  async eraseUserData(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('Token de acceso requerido.')
    }

    try {
      return await this.adminService.eraseUserData(id, request.authUser.sub)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido'
      throw new NotFoundException(message)
    }
  }

  @Get('breach-alerts')
  getBreachAlerts() {
    return this.adminService.getBreachAlerts()
  }

  @Post('breach-alerts/:id/notify')
  notifyBreach(@Param('id') id: string) {
    return this.adminService.notifyBreach(id)
  }

  @Get('tenants/:id')
  getTenantDetails(@Param('id') id: string) {
    return this.adminService.getTenantDetails(id)
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id') id: string,
    @Body() body: { name?: string; sector?: string; city?: string; costMethod?: string; allowNegativeStock?: boolean },
  ) {
    return this.adminService.updateTenant(id, body)
  }

  @Patch('tenants/:id/subscription')
  updateSubscription(
    @Param('id') id: string,
    @Body() body: { planType?: string; active?: boolean; trialEndsAt?: string | null },
  ) {
    return this.adminService.updateSubscription(id, body)
  }

  @Post('companies')
  createCompany(@Body() body: {
    name: string
    adminName: string
    adminEmail: string
    prefix?: string
    plan?: string
    city?: string
  }) {
    return this.adminService.createCompany(body)
  }

  @Patch('tenants/:id/status')
  updateTenantStatus(
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'suspended' },
  ) {
    return this.adminService.updateTenantStatus(id, body.status)
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) {
    return this.adminService.deleteTenant(id)
  }
}
