import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { AuthGuard } from '../auth/auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

@Controller('taxes')
@UseGuards(AuthGuard)
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Post('calculate')
  async calculate(
    @Body() body: { subtotal: number; regime?: string; clientCity?: string },
  ) {
    return this.taxesService.calculateTaxes(body.subtotal, body.regime, body.clientCity);
  }
}
