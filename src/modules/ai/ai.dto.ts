import { IsString, IsOptional, MaxLength, MinLength, IsArray, ArrayMaxSize } from 'class-validator'

export class ChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  message!: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  history?: any[]

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  attachment?: string
}
