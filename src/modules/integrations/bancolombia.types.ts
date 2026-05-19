import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export const BANCOLOMBIA_INTEGRATION_MODES = ['open_finance', 'treasury_feed'] as const
export const BANCOLOMBIA_ENVIRONMENTS = ['sandbox', 'production'] as const
export const BANCOLOMBIA_ACCOUNT_TYPES = ['Ahorros', 'Corriente'] as const
export const BANCOLOMBIA_STATEMENT_FORMATS = ['MT940', 'CAMT053'] as const
export const BANCOLOMBIA_AUTH_STATUSES = ['draft', 'ready', 'connected', 'paused'] as const

export type BancolombiaIntegrationMode = (typeof BANCOLOMBIA_INTEGRATION_MODES)[number]
export type BancolombiaEnvironment = (typeof BANCOLOMBIA_ENVIRONMENTS)[number]
export type BancolombiaAccountType = (typeof BANCOLOMBIA_ACCOUNT_TYPES)[number]
export type BancolombiaStatementFormat = (typeof BANCOLOMBIA_STATEMENT_FORMATS)[number]
export type BancolombiaAuthorizationStatus = (typeof BANCOLOMBIA_AUTH_STATUSES)[number]

export class BancolombiaConfigDto {
  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsIn(BANCOLOMBIA_INTEGRATION_MODES, { message: 'Modo de integracion invalido.' })
  integrationMode?: BancolombiaIntegrationMode

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsIn(BANCOLOMBIA_ENVIRONMENTS, { message: 'Ambiente invalido.' })
  environment?: BancolombiaEnvironment

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'El numero de cuenta debe ser texto.' })
  @MinLength(1, { message: 'El numero de cuenta es requerido.' })
  accountNumber?: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsIn(BANCOLOMBIA_ACCOUNT_TYPES, { message: 'Tipo de cuenta invalido.' })
  accountType?: BancolombiaAccountType

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'El Client ID debe ser texto.' })
  clientId?: string

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsIn(BANCOLOMBIA_STATEMENT_FORMATS, { message: 'Formato de extracto invalido.' })
  statementFormat?: BancolombiaStatementFormat

  @IsOptional()
  @Transform(({ value }) => String(value || '').trim())
  @IsString({ message: 'La URL de origen debe ser texto.' })
  statementSourceUrl?: string
}

export interface BancolombiaStatementEntryInput {
  date?: string
  description?: string
  amount?: number | string
  type?: 'INCOME' | 'EXPENSE' | 'credit' | 'debit' | 'income' | 'expense'
  reference?: string
  counterparty?: string
  bankAccount?: string
}

export interface BancolombiaStatementFileInput {
  fileName?: string
  contentType?: string
  text?: string
  contentBase64?: string
  format?: BancolombiaStatementFormat
}

export interface BancolombiaSyncDto {
  entries?: BancolombiaStatementEntryInput[]
  statement?: {
    entries?: BancolombiaStatementEntryInput[]
    movements?: BancolombiaStatementEntryInput[]
    transactions?: BancolombiaStatementEntryInput[]
    data?: BancolombiaStatementEntryInput[]
  }
  statementFile?: BancolombiaStatementFileInput
}
