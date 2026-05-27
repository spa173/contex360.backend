import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsArray, ValidateNested, ArrayMaxSize, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { QuoteStatus } from '@prisma/client'

export class QuoteItemDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class CreateQuoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientId!: string

  @IsOptional()
  @IsString()
  validUntil?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(500)
  @Type(() => QuoteItemDto)
  items!: QuoteItemDto[]
}

export class UpdateQuoteStatusDto {
  @IsEnum(QuoteStatus)
  status!: QuoteStatus
}
