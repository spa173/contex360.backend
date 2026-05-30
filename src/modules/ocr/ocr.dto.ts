import {
  IsBoolean,
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
} from 'class-validator'
import { Type } from 'class-transformer'

// ── Upload ────────────────────────────────────────────────────────────────────

export class OcrUploadDto {
  /**
   * If true, automatically create a Purchase (draft) from the extracted data.
   * Requires the extracted vendor to match a known ThirdParty (by NIT).
   */
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  autoCreatePurchase?: boolean = false

  /**
   * Optional notes to attach to the OCR run for operator context.
   */
  @IsString()
  @IsOptional()
  notes?: string
}

// ── List query ────────────────────────────────────────────────────────────────

export class OcrListQueryDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20

  @IsEnum(['pending', 'processing', 'processed', 'failed'])
  @IsOptional()
  status?: string

  /** Filter by original file name substring */
  @IsString()
  @IsOptional()
  search?: string
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export class OcrRetryDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  autoCreatePurchase?: boolean = false
}
