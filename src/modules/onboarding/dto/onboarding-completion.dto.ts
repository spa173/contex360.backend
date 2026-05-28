import { IsString, IsOptional, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class OnboardingCompletionDto {
  @ApiProperty({ description: 'Nombre de la empresa', example: 'Mi Empresa SAS' })
  @IsString()
  companyName!: string

  @ApiPropertyOptional({ description: 'NIT de la empresa', example: '900123456-7' })
  @IsOptional()
  @IsString()
  nit?: string

  @ApiPropertyOptional({ description: 'Dirección de la empresa', example: 'Cra 10 # 20-30' })
  @IsOptional()
  @IsString()
  address?: string

  @ApiPropertyOptional({ description: 'Teléfono de contacto', example: '3001234567' })
  @IsOptional()
  @IsString()
  phone?: string

  @ApiPropertyOptional({ description: 'Ciudad', example: 'Bogotá' })
  @IsOptional()
  @IsString()
  city?: string

  @ApiPropertyOptional({ description: 'Sector económico', example: 'comercio', enum: ['comercio', 'servicios', 'industria', 'tecnologia', 'salud', 'educacion', 'construccion', 'otro'] })
  @IsOptional()
  @IsString()
  @IsIn(['comercio', 'servicios', 'industria', 'tecnologia', 'salud', 'educacion', 'construccion', 'otro'])
  sector?: string

  @ApiPropertyOptional({ description: 'Acepta términos y condiciones', example: true })
  @IsOptional()
  acceptedTerms?: boolean

  @ApiPropertyOptional({ description: 'Acepta política de privacidad', example: true })
  @IsOptional()
  acceptedPrivacy?: boolean

  @ApiPropertyOptional({ description: 'Acepta procesamiento de datos', example: true })
  @IsOptional()
  acceptedDataProcessing?: boolean
}
