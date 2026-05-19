import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { SupportService } from './support.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthenticatedRequest } from '../auth/auth.types'
import { Req } from '@nestjs/common'

@Controller('support')
@UseGuards(AuthGuard, PermissionsGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  @Permissions('view_dashboard')
  createTicket(
    @Body() body: {
      subject: string
      description: string
      priority?: 'baja' | 'media' | 'alta' | 'critica'
    },
    @TenantId() tenantId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.supportService.createTicket({
      tenantId,
      userId: req.authUser?.sub ?? null,
      userName: req.authUser?.email ?? 'Usuario',
      userEmail: req.authUser?.email ?? '',
      subject: body.subject,
      description: body.description,
      priority: body.priority as any,
    })
  }

  @Get('tickets')
  @Permissions('view_admin')
  getAllTickets() {
    return this.supportService.getAllTickets()
  }

  @Put('tickets/:id/status')
  @Permissions('view_admin')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.supportService.updateTicketStatus(id, status)
  }
}
