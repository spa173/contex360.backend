import { IsString, IsNumber, IsOptional, Min, Max, MaxLength, MinLength, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { TransactionType, TransactionCategory } from '@prisma/client'

export class CreateTransactionDto {
  @IsEnum(TransactionType)
  type!: TransactionType

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  @Type(() => Number)
  amount!: number

  @IsOptional()
  @IsString()
  date?: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string

  @IsOptional()
  @IsEnum(TransactionCategory)
  category?: TransactionCategory

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  purchaseId?: string
}
