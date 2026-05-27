import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsArray, ValidateNested, ArrayMaxSize } from 'class-validator'
import { Type } from 'class-transformer'

export class PurchaseItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  productName!: string

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

export class CreatePurchaseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  providerId!: string

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
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[]
}

export class UpdatePurchaseStatusDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  status!: string
}
