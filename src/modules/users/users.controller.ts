import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { UsersService } from './users.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { PlanGuard } from '../auth/plan.guard'
import { CheckPlanLimit } from '../auth/plan.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthUser } from '../../common/decorators/auth-user.decorator'
import type { AuthenticatedRequest, AuthTokenPayload } from '../auth/auth.types'
import {
  CreateUserDto,
  UpsertMembershipDto,
  RemoveMembershipDto,
  CreateInvitationDto,
  SetTwoFactorRequirementDto,
  ScheduleDeactivationDto,
} from './dto/users.dto'

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('view_users')
  async findAll(@TenantId() tenantId: string) {
    return this.usersService.findAll(tenantId)
  }

  @Get(':id')
  @Permissions('view_users')
  async findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.usersService.findOne(tenantId, id)
  }

  @Post()
  @UseGuards(PermissionsGuard, PlanGuard)
  @Permissions('manage_users')
  @CheckPlanLimit('maxUsers')
  async createUser(@Body() dto: CreateUserDto, @TenantId() tenantId: string) {
    const result = await this.usersService.createUser({ ...dto, tenantId })
    return { ok: true, message: 'Usuario creado exitosamente', user: result.user, tempPassword: result.tempPassword }
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async toggleStatus(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.usersService.toggleStatus(id, tenantId)
  }

  @Post(':id/force-password-reset')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async forcePasswordReset(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.usersService.forcePasswordReset(id, tenantId)
  }

  @Post(':id/temp-password')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async generateTempPassword(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.usersService.generateAndSetTempPassword(id, tenantId)
  }

  @Patch(':id/2fa/requirement')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async setTwoFactorRequirement(
    @Param('id') id: string,
    @Body() body: SetTwoFactorRequirementDto,
    @TenantId() tenantId: string,
  ) {
    return this.usersService.setTwoFactorRequirement(id, body.required, tenantId)
  }

  @Post(':id/2fa/toggle')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async toggleTwoFactor(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.usersService.toggleTwoFactor(id, tenantId)
  }

  @Post(':id/sessions/revoke')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async revokeUserSessions(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.usersService.revokeUserSessions(id, tenantId)
  }

  @Delete('sessions/:sessionId')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Param('sessionId') sessionId: string, @TenantId() tenantId: string) {
    return this.usersService.revokeSession(sessionId, tenantId)
  }

  @Post('sessions/panic-revoke')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async panicRevokeAll(@TenantId() tenantId: string) {
    return this.usersService.panicRevokeAll(tenantId)
  }

  @Post('memberships')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async upsertMembership(@Body() body: UpsertMembershipDto, @AuthUser() authUser: AuthTokenPayload) {
    return this.usersService.upsertMembership({ ...body, actorUserId: authUser.sub, actorEmail: authUser.email })
  }

  @Delete('memberships')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async removeMembership(@Body() body: RemoveMembershipDto) {
    return this.usersService.removeMembership(body)
  }

  @Post('invitations')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(@Body() body: CreateInvitationDto, @AuthUser() authUser: AuthTokenPayload) {
    return this.usersService.createInvitation(body, authUser.sub)
  }

  @Post('invitations/:id/resend')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async resendInvitation(@Param('id') id: string) {
    return this.usersService.resendInvitation(id)
  }

  @Post('sessions/:sessionId/trust')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async trustSessionFingerprint(@Param('sessionId') sessionId: string, @TenantId() tenantId: string) {
    return this.usersService.trustSessionFingerprint(sessionId, tenantId)
  }

  @Post('recovery-codes')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async generateRecoveryCodes(@AuthUser() authUser: AuthTokenPayload) {
    return this.usersService.generateRecoveryCodes(authUser.sub)
  }

  @Post(':id/schedule-deactivation')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async scheduleDeactivation(
    @Param('id') id: string,
    @Body() body: ScheduleDeactivationDto,
    @TenantId() tenantId: string,
    @AuthUser() authUser: AuthTokenPayload,
  ) {
    return this.usersService.scheduleDeactivation(id, body.at, tenantId, authUser.sub)
  }

  @Post(':id/anonymize')
  @UseGuards(PermissionsGuard)
  @Permissions('manage_users')
  @HttpCode(HttpStatus.OK)
  async anonymizeUser(@Param('id') id: string) {
    return this.usersService.anonymizeUser(id)
  }
}
