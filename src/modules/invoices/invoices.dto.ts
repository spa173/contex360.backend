import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsArray, ValidateNested, ArrayMaxSize, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { InvoiceStatus } from '@prisma/client'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class InvoiceItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @ApiProperty({ description: 'ID del producto', example: 'prod-123' })
  productId!: string

  @IsNumber()
  @Min(1)
  @Max(999999999)
  @Type(() => Number)
  @ApiProperty({ description: 'Cantidad del producto', example: 2 })
  quantity!: number

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  @ApiProperty({ description: 'Precio unitario', example: 1000 })
  unitPrice!: number

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  @ApiPropertyOptional({ description: 'Tasa de impuesto (porcentaje)', example: 19 })
  taxRate?: number
}

export class CreateInvoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @ApiProperty({ description: 'ID del cliente', example: 'cli-456' })
  clientId!: string

  @IsNumber()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  @ApiProperty({ description: 'Días de término de pago', example: 30 })
  paymentTermDays!: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @ApiPropertyOptional({ description: 'Notas de la factura', example: 'Pago por servicios' })
  notes?: string

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(500)
  @Type(() => InvoiceItemDto)
  @ApiProperty({ description: 'Lista de ítems de la factura', type: [InvoiceItemDto] })
  items!: InvoiceItemDto[]
}

export class UpdateInvoiceStatusDto {
  @IsEnum(InvoiceStatus)
  status!: InvoiceStatus
}

export class CancelInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string
}
