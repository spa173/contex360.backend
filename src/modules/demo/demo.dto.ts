import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator'

export class CreateDemoRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  empresa!: string

  @IsString()
  @MaxLength(320)
  correo!: string

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mensaje?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nit?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ciudad?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  direccion?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string
}
