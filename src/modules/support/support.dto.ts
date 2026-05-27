import { IsString, IsOptional, MaxLength, MinLength, IsIn } from 'class-validator'

export class CreateTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subject!: string

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string

  @IsOptional()
  @IsIn(['baja', 'media', 'alta', 'critica'])
  priority?: 'baja' | 'media' | 'alta' | 'critica'
}
