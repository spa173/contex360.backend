import { IsString, IsOptional, IsIn, MaxLength, MinLength } from 'class-validator'

export class CheckoutDto {
  @IsIn(['starter', 'pyme', 'enterprise'])
  planType!: 'starter' | 'pyme' | 'enterprise'

  @IsIn(['monthly', 'annual'])
  billing!: 'monthly' | 'annual'
}

export class WompiWebhookDto {
  data!: any

  @IsOptional()
  signature?: { checksum?: string; properties?: string[] }

  @IsOptional()
  timestamp?: number

  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @IsString()
  event?: string
}
