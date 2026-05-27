import { IsString, IsOptional, MaxLength } from 'class-validator'

export class UpdateDianConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dianEnvironment?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dianSoftwareId?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dianSoftwarePin?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dianNit?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dianTestSetId?: string

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  dianCertificate?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  dianCertificatePassword?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceResolution?: string

  @IsOptional()
  @IsString()
  resolutionFrom?: string

  @IsOptional()
  @IsString()
  resolutionTo?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dianOperationCode?: string
}
