import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsArray, ValidateNested, ArrayMaxSize } from 'class-validator'
import { Type } from 'class-transformer'

export class LedgerLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  account!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  debit!: number

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  credit!: number
}

export class CreateLedgerEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  referenceType!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  entryAt?: string

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(100)
  @Type(() => LedgerLineDto)
  lines!: LedgerLineDto[]
}
