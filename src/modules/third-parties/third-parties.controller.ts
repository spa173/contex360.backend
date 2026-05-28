import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, UploadedFile, MaxFileSizeValidator, ParseFilePipe, FileTypeValidator } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiBody } from '@nestjs/swagger'
import { ThirdPartiesService } from './third-parties.service'
import { Permissions } from '../auth/permissions.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { ThirdPartyKind } from '@prisma/client'
import { CreateThirdPartyDto, UpdateThirdPartyDto } from './third-parties.dto'

@Controller('third-parties')
@UseGuards(AuthGuard, PermissionsGuard)
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
    @Body() data: CreateThirdPartyDto,
  ) {
    return this.thirdPartiesService.create(tenantId, data)
  }

  @Post('import')
  @Permissions('manage_third_parties')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async import(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(text\/csv|application\/vnd\.ms-excel)/ }),
        ],
      }),
    ) file: any,
    @TenantId() tenantId: string,
  ) {
    return this.thirdPartiesService.importCsv(tenantId, file.buffer)
  }

  @Put(':id')
  @Permissions('manage_third_parties')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() data: UpdateThirdPartyDto,
  ) {
    return this.thirdPartiesService.update(tenantId, id, data)
  }

  @Delete(':id')
  @Permissions('manage_third_parties')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.thirdPartiesService.remove(tenantId, id)
  }
}
