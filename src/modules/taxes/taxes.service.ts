import { Injectable, Logger } from '@nestjs/common';

export interface TaxResult {
  base: number;
  iva: number;
  ica: number;
  retefuente: number;
  total: number;
  ivaRate: number;
  icaRate: number;
  retefuenteRate: number;
  regime: string;
}

@Injectable()
export class TaxesService {
  private readonly logger = new Logger(TaxesService.name);

  async calculateTaxes(
    subtotal: number,
    regime?: string,
    clientCity?: string,
  ): Promise<TaxResult> {
    const effectiveRegime = regime || 'comun';
    const city = clientCity || '';

    let ivaRate = 0.19;
    let icaRate = 0;
    let retefuenteRate = 0;

    if (effectiveRegime === 'simplificado') {
      ivaRate = 0;
    } else if (effectiveRegime === 'comun') {
      ivaRate = 0.19;
      retefuenteRate = 0.02;
    } else if (effectiveRegime === 'especial') {
      ivaRate = 0.05;
    }

    icaRate = this.getIcaRate(city);

    const base = subtotal;
    const iva = Math.round(base * ivaRate);
    const ica = Math.round(base * icaRate);
    const retefuente = Math.round(base * retefuenteRate);
    const total = base + iva + ica - retefuente;

    return {
      base,
      iva,
      ica,
      retefuente,
      total,
      ivaRate,
      icaRate,
      retefuenteRate,
      regime: effectiveRegime,
    };
  }

  private getIcaRate(city: string): number {
    const rates: Record<string, number> = {
      'bogotá': 0.004,
      'medellín': 0.003,
      'cali': 0.003,
      'barranquilla': 0.003,
      'cartagena': 0.004,
    };
    return rates[city.toLowerCase().trim()] || 0.003;
  }
}
