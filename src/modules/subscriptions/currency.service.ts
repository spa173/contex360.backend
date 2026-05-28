import { Injectable, Logger } from '@nestjs/common'

export interface CurrencyInfo {
  code: string
  symbol: string
  name: string
  namePlural: string
  rateToCop: number
  decimals: number
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  COP: { code: 'COP', symbol: '$', name: 'Peso colombiano', namePlural: 'Pesos colombianos', rateToCop: 1, decimals: 0 },
  USD: { code: 'USD', symbol: 'US$', name: 'Dólar estadounidense', namePlural: 'Dólares estadounidenses', rateToCop: 4400, decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', namePlural: 'Euros', rateToCop: 4800, decimals: 2 },
  MXN: { code: 'MXN', symbol: 'MX$', name: 'Peso mexicano', namePlural: 'Pesos mexicanos', rateToCop: 260, decimals: 2 },
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name)

  getAvailableCurrencies(): CurrencyInfo[] {
    return Object.values(CURRENCIES)
  }

  getCurrency(code: string): CurrencyInfo {
    return CURRENCIES[code.toUpperCase()] || CURRENCIES.COP
  }

  convertToCop(amount: number, fromCurrency: string): number {
    const rate = this.getCurrency(fromCurrency).rateToCop
    return Math.round(amount * rate)
  }

  convertFromCop(amountInCop: number, toCurrency: string): number {
    const rate = this.getCurrency(toCurrency).rateToCop
    return this.roundToDecimals(amountInCop / rate, toCurrency)
  }

  format(amountInCop: number, currencyCode: string): string {
    const info = this.getCurrency(currencyCode)
    const converted = this.convertFromCop(amountInCop, currencyCode)
    return new Intl.NumberFormat(`es-${currencyCode === 'COP' ? 'CO' : currencyCode.slice(0, 2)}`, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(converted)
  }

  private roundToDecimals(value: number, currencyCode: string): number {
    const decimals = this.getCurrency(currencyCode).decimals
    const factor = Math.pow(10, decimals)
    return Math.round(value * factor) / factor
  }
}
