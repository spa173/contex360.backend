import { Transform } from 'class-transformer'
import { IsEmail, IsEnum, IsOptional, IsString, MinLength, MaxLength, IsBoolean } from 'class-validator'

const VALID_ROLES = ['owner', 'Administrador', 'Contador', 'Auxiliar contable', 'Gerencia', 'Visor', 'Operador'] as const

export class CreateUserDto {
  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'El nombre es requerido.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres.' })
  name!: string

  @Transform(({ value }) => String(value || '').trim().toLowerCase())
  @IsEmail({}, { message: 'El formato del email es invalido.' })
  email!: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  @MaxLength(100)
  title?: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString()
  @MaxLength(100)
  password?: string

  @IsOptional()
  @IsString({ message: 'El tenantId debe ser un texto.' })
  tenantId?: string

  @IsOptional()
  @IsEnum(VALID_ROLES as any, { message: 'Rol no valido. Roles permitidos: ' + VALID_ROLES.join(', ') })
  role?: string
}

export class UpsertMembershipDto {
  @IsString({ message: 'El userId es requerido.' })
  @MinLength(1, { message: 'El userId no puede estar vacio.' })
  userId!: string

  @IsString({ message: 'El tenantId es requerido.' })
  @MinLength(1, { message: 'El tenantId no puede estar vacio.' })
  tenantId!: string

  @IsEnum(VALID_ROLES as any, { message: 'Rol no valido. Roles permitidos: ' + VALID_ROLES.join(', ') })
  role!: string
}

export class RemoveMembershipDto {
  @IsString({ message: 'El userId es requerido.' })
  @MinLength(1, { message: 'El userId no puede estar vacio.' })
  userId!: string

  @IsString({ message: 'El tenantId es requerido.' })
  @MinLength(1, { message: 'El tenantId no puede estar vacio.' })
  tenantId!: string
}

export class CreateInvitationDto {
  @Transform(({ value }) => String(value || '').trim().toLowerCase())
  @IsEmail({}, { message: 'El formato del email es invalido.' })
  email!: string

  @IsEnum(VALID_ROLES as any, { message: 'Rol no valido.' })
  role!: string

  @IsString({ message: 'El tenantId es requerido.' })
  @MinLength(1, { message: 'El tenantId no puede estar vacio.' })
  tenantId!: string
}

export class SetTwoFactorRequirementDto {
  @IsBoolean({ message: 'El campo required debe ser un booleano.' })
  required!: boolean
}

export class ScheduleDeactivationDto {
  @IsString({ message: 'La fecha es requerida.' })
  @MinLength(1, { message: 'La fecha no puede estar vacia.' })
  at!: string
}
