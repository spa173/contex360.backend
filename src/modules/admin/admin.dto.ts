import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsBoolean, IsArray, ArrayMaxSize } from 'class-validator'
import { Type } from 'class-transformer'

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nit?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  costMethod?: string

  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpHost?: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  smtpPort?: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  smtpUser?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpPassword?: string

  @IsOptional()
  @IsString()
  @MaxLength(320)
  smtpFromEmail?: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  activeIntegrations?: string[]

  @IsOptional()
  adminSettings?: any
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  planType?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean

  @IsOptional()
  @IsString()
  trialEndsAt?: string | null
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  adminName!: string

  @IsString()
  @MaxLength(320)
  adminEmail!: string

  @IsOptional()
  @IsString()
  @MaxLength(10)
  prefix?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nit?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string
}

export class UpdateTenantStatusDto {
  @IsString()
  status!: 'active' | 'suspended'
}

export class DeleteTenantDto {
  @IsOptional()
  @IsString()
  password?: string
}
