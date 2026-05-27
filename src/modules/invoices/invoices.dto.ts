import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsArray, ValidateNested, ArrayMaxSize, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { InvoiceStatus } from '@prisma/client'

export class InvoiceItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string

  @IsNumber()
  @Min(1)
  @Max(999999999)
  @Type(() => Number)
  quantity!: number

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  unitPrice!: number

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  taxRate!: number
}

export class CreateInvoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientId!: string

  @IsNumber()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  paymentTermDays!: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(500)
  @Type(() => InvoiceItemDto)
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
