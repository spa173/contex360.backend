import { Controller, Get, Post, Body, Param, UseGuards, UseInterceptors, UploadedFile, MaxFileSizeValidator, ParseFilePipe, FileTypeValidator } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger'
import { ProductsService } from './products.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { CreateProductDto } from './products.dto'

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
@UseGuards(AuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Permissions('view_inventory')
  @ApiOperation({ summary: 'Listar todos los productos del tenant activo' })
  @ApiResponse({ status: 200, description: 'Lista de productos' })
  findAll(@TenantId() tenantId: string) {
    return this.productsService.findAll(tenantId)
  }

  @Get(':id')
  @Permissions('view_inventory')
  @ApiOperation({ summary: 'Obtener un producto por ID' })
  @ApiResponse({ status: 200, description: 'Producto encontrado' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.productsService.findOne(id, tenantId)
  }

  @Post()
  @Permissions('manage_inventory')
  @ApiOperation({ summary: 'Crear un nuevo producto' })
  @ApiResponse({ status: 201, description: 'Producto creado exitosamente' })
  create(@Body() data: CreateProductDto, @TenantId() tenantId: string) {
    return this.productsService.create(data, tenantId)
  }

  @Post('import')
  @Permissions('manage_inventory')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Importar productos desde CSV' })
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
    return this.productsService.importCsv(tenantId, file.buffer)
  }
}
