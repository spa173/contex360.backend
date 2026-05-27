import { IsString, MaxLength, MinLength } from 'class-validator'

export class SendEmailDto {
  @IsString()
  @MaxLength(320)
  to!: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subject!: string

  @IsString()
  @MaxLength(100000)
  html!: string
}
