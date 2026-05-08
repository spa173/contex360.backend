import { Controller, Get, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { AdminGuard } from '../auth/admin.guard'
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
}
