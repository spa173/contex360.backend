import { Injectable } from '@nestjs/common';
import { CONTRATOS_LEGALES } from '../contratos/legal-texts';

export interface LegalDocument {
  version: string;
  lastUpdated: string;
  title: string;
  content: string;
}

@Injectable()
export class LegalService {
  private readonly lastUpdated = '2026-05-12';

  getTermsOfService(): LegalDocument {
    const ct = CONTRATOS_LEGALES.find(c => c.tipo === 'terminosCondiciones');
    return {
      version: ct?.version || '1.0',
      lastUpdated: this.lastUpdated,
      title: ct?.titulo || 'Términos y Condiciones de Uso — Contex360',
      content: ct?.cuerpo || '',
    };
  }

  getPrivacyPolicy(): LegalDocument {
    const ct = CONTRATOS_LEGALES.find(c => c.tipo === 'politicaPrivacidad');
    return {
      version: ct?.version || '1.0',
      lastUpdated: this.lastUpdated,
      title: ct?.titulo || 'Política de Privacidad — Contex360',
      content: ct?.cuerpo || '',
    };
  }

  getDataProcessingAgreement(): LegalDocument {
    const ct = CONTRATOS_LEGALES.find(c => c.tipo === 'acuerdoProcesamientoDatos');
    return {
      version: ct?.version || '1.0',
      lastUpdated: this.lastUpdated,
      title: ct?.titulo || 'Acuerdo de Procesamiento de Datos (DPA) — Contex360',
      content: ct?.cuerpo || '',
    };
  }

  getBusinessContinuityPlan(): LegalDocument {
    return {
      version: '1.0',
      lastUpdated: this.lastUpdated,
      title: 'Plan de Continuidad del Negocio — Contex360',
      content: `1. OBJETIVO
Garantizar la continuidad de las operaciones críticas de Contex360 ante interrupciones significativas.

2. ALCANCE
Este plan cubre la infraestructura de producción: API, base de datos, autenticación y servicios de facturación electrónica.

3. OBJETIVOS DE RECUPERACIÓN
- RTO (Recovery Time Objective): 4 horas
- RPO (Recovery Point Objective): 30 minutos
- Prueba de restauración: Mensual

4. ESCENARIOS CUBIERTOS
- Caída total de la API
- Pérdida de acceso a la base de datos
- Error crítico de autenticación
- Despliegue fallido en producción

5. PROCEDIMIENTOS
5.1. Activación del plan ante incidente crítico.
5.2. Evaluación del impacto y comunicación a stakeholders.
5.3. Restauración desde backup más reciente.
5.4. Verificación de integridad de datos.
5.5. Pruebas de funcionalidad crítica.
5.6. Retorno a operación normal.

6. RESPONSABLES
Dirección de TI y Operaciones.`.trim(),
    };
  }
}
