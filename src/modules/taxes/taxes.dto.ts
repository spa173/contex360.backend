import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CalculateTaxesDto {
  @IsNumber()
  @Min(0)
  subtotal!: number;

  @IsOptional()
  @IsString()
  regime?: string;

  @IsOptional()
  @IsString()
  clientCity?: string;
}
