import { IsString, IsOptional, Min, Max, MaxLength, MinLength, IsBoolean, IsEnum, IsArray, ArrayMaxSize } from 'class-validator'
import { ThirdPartyKind, TaxRegime } from '@prisma/client'

export class CreateThirdPartyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  nit!: string

  @IsString()
  @MaxLength(320)
  email!: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string

  @IsEnum(ThirdPartyKind)
  kind!: ThirdPartyKind

  @IsString()
  @MaxLength(200)
  taxProfile!: string

  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  fiscalResponsibilities?: string[]
}

export class UpdateThirdPartyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  nit?: string

  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string

  @IsOptional()
  @IsEnum(ThirdPartyKind)
  kind?: ThirdPartyKind

  @IsOptional()
  @IsString()
  @MaxLength(200)
  taxProfile?: string

  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  fiscalResponsibilities?: string[]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
