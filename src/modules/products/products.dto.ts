import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsBoolean } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string

  @IsString()
  @MaxLength(100)
  sku!: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  price!: number

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  cost?: number

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  taxRate?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  @Type(() => Number)
  stock?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  @Type(() => Number)
  minStock?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  @Type(() => Number)
  maxStock?: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string

  @IsOptional()
  @IsBoolean()
  isInventoriable?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(50)
  productType?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string
}
