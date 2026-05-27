import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsEnum, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { InventoryMovementType } from '@prisma/client'

export class CreateMovementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string

  @IsEnum(InventoryMovementType)
  type!: InventoryMovementType

  @IsNumber()
  @Min(1)
  @Max(999999999)
  @Type(() => Number)
  quantity!: number

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  batch?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attachmentUrl?: string
}

export class TransferStockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fromLocId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  toLocId!: string

  @IsNumber()
  @Min(1)
  @Max(999999999)
  @Type(() => Number)
  quantity!: number
}

export class InventoryAdjustmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  locationId!: string

  @IsNumber()
  @Min(0)
  @Max(999999999)
  @Type(() => Number)
  physicalCount!: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  photoBase64?: string
}

export class AuditInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(1000)
  @Type(() => InventoryAdjustmentDto)
  adjustments!: InventoryAdjustmentDto[]
}

export class ReceiveInventoryDto {
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
  unitCost!: number

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  locId!: string
}
