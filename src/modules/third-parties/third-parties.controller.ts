import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ThirdPartiesService } from './third-parties.service'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { ThirdPartyKind } from '@prisma/client'

@Controller('third-parties')
@UseGuards(PermissionsGuard)
export class ThirdPartiesController {
  constructor(private readonly thirdPartiesService: ThirdPartiesService) {}

  @Get()
  @Permissions('view_third_parties')
  findAll(@TenantId() tenantId: string, @Query('kind') kind?: ThirdPartyKind) {
    return this.thirdPartiesService.findAll(tenantId, kind)
  }

  @Get(':id')
  @Permissions('view_third_parties')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.thirdPartiesService.findOne(tenantId, id)
  }

  @Post()
  @Permissions('manage_third_parties')
  create(
    @TenantId() tenantId: string,
    @Body() data: {
      name: string
      nit: string
      email: string
      kind: ThirdPartyKind
      taxProfile: string
    },
  ) {
    return this.thirdPartiesService.create(tenantId, data)
  }

  @Put(':id')
  @Permissions('manage_third_parties')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() data: Partial<{
      name: string
      nit: string
      email: string
      kind: ThirdPartyKind
      taxProfile: string
    }>,
  ) {
    return this.thirdPartiesService.update(tenantId, id, data)
  }

  @Delete(':id')
  @Permissions('manage_third_parties')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.thirdPartiesService.remove(tenantId, id)
  }
}
