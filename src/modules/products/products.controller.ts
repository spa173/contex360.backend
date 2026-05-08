import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common'
import { ProductsService } from './products.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { TenantId } from '../../common/decorators/tenant.decorator'

@Controller('products')
@UseGuards(AuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Permissions('manage_inventory') // Only users with this permission can list products
  findAll(@TenantId() tenantId: string) {
    return this.productsService.findAll(tenantId)
  }

  @Get(':id')
  @Permissions('manage_inventory')
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.productsService.findOne(id, tenantId)
  }

  @Post()
  @Permissions('manage_inventory')
  create(@Body() data: any, @TenantId() tenantId: string) {
    return this.productsService.create(data, tenantId)
  }
}
