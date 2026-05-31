# Backend Roadmap Técnico — Contex360 ERP
**Versión:** 1.0 — Mayo 2026  
**Autor:** Análisis arquitectónico basado en gap analysis Landing Page vs. Backend real  
**Stack:** NestJS · Prisma · PostgreSQL (Neon) · Wompi · DIAN · Gemini/Groq

---

## 📌 Principios de priorización

| Criterio | Peso |
|---|---|
| Afecta ingresos directamente (billing, conversión, retención) | ×3 |
| Rompe promesas comerciales activas en la landing | ×2 |
| Bloquea escalabilidad en producción | ×2 |
| Mejora onboarding y activación | ×1.5 |
| Reduce deuda técnica crítica | ×1 |

---

## 🗺️ Vista de sprints (12 semanas)

```
Semana 1-2   │ Sprint 0 — Quick Wins P0 (ingresos, promesas rotas + reportes contables base)
Semana 3-4   │ Sprint 1 — Onboarding, activación & OCR
Semana 5-6   │ Sprint 2 — Inteligencia IA (sobre reportes ya existentes) & conciliación
Semana 7-8   │ Sprint 3 — Resiliencia y seguridad operacional
Semana 9-10  │ Sprint 4 — Escalabilidad de infraestructura
Semana 11-12 │ Sprint 5 — Ecosistema y expansión
```

---

## 🔴 P0 — Sprint 0 (Semanas 1–2)
> **Criterio:** Rompen ingresos reales o promesas activas en landing hoy.

---

### P0-1 · Quota enforcement — 50 facturas/mes plan Starter

| Atributo | Valor |
|---|---|
| **Impacto ingresos** | 🔴 Crítico — sin esto, Starter tiene facturas ilimitadas, eliminando la razón de upgrade a Pyme |
| **Esfuerzo** | XS — ~50 líneas en `invoices.service.ts` |
| **Riesgo** | Bajo |
| **Dependencias** | Ninguna — `Subscription.invoicesThisMonth` ya existe en schema |

**Implementación:**

```typescript
// src/modules/invoices/invoices.service.ts
async create(dto: CreateInvoiceDto, tenantId: string) {
  const sub = await this.prisma.subscription.findUnique({
    where: { tenantId },
    select: { planType: true, invoicesThisMonth: true, active: true },
  })

  const plan = PLANS[sub?.planType ?? 'starter']
  if (plan.maxInvoicesPerMonth !== null) {
    if ((sub?.invoicesThisMonth ?? 0) >= plan.maxInvoicesPerMonth) {
      throw new ForbiddenException(
        `Has alcanzado el límite de ${plan.maxInvoicesPerMonth} facturas/mes del plan ${plan.name}. ` +
        `Actualiza tu plan para continuar facturando.`
      )
    }
  }

  const invoice = await this.prisma.invoice.create({ ... })

  await Promise.all([
    this.prisma.subscription.update({
      where: { tenantId },
      data: { invoicesThisMonth: { increment: 1 } },
    }),
    this.prisma.usageRecord.create({
      data: { tenantId, feature: 'invoice_created' },
    }),
  ])

  return invoice
}
```

**Cron de reset mensual (añadir en `subscriptions` scheduler):**
```typescript
@Cron('0 0 1 * *') // 1ro de cada mes, medianoche
async resetMonthlyInvoiceCounters() {
  await this.prisma.subscription.updateMany({
    data: { invoicesThisMonth: 0 },
  })
  this.logger.log('Contadores mensuales de facturas reseteados')
}
```

**Campos a añadir en `plans.config.ts`:**
```typescript
export const PLANS = {
  starter:    { name: 'Starter',    maxInvoicesPerMonth: 50,   maxUsers: 1    },
  pyme:       { name: 'Pyme',       maxInvoicesPerMonth: null, maxUsers: 5    },
  enterprise: { name: 'Enterprise', maxInvoicesPerMonth: null, maxUsers: null },
}
```

---

### P0-2 · Importación masiva Excel — Terceros y Productos

| Atributo | Valor |
|---|---|
| **Impacto onboarding** | 🔴 Crítico — FAQ de la landing promete explícitamente esta feature |
| **Impacto ingresos** | 🟠 Alto — sin importación, el onboarding tarda días → churn en primera semana |
| **Esfuerzo** | S — 1.5 días por endpoint |
| **Riesgo** | Bajo — inserción por lotes con `skipDuplicates` |
| **Dependencias** | Instalar `exceljs` / `xlsx` |

**Endpoints a crear en `onboarding.controller.ts`:**

```
POST /api/v1/onboarding/import/third-parties   multipart/form-data
POST /api/v1/onboarding/import/products        multipart/form-data
POST /api/v1/onboarding/import/inventory       multipart/form-data (ajustes de stock inicial)
```

**Lógica de importación estandarizada:**

```typescript
// src/modules/onboarding/importers/base-importer.ts
export interface ImportResult {
  imported: number
  skipped:  number
  errors:   { row: number; field: string; reason: string }[]
}

async function processExcel<T>(
  buffer: Buffer,
  schema: ZodSchema<T>,
  upsertFn: (rows: T[]) => Promise<number>
): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  const rows: T[] = []
  const errors: ImportResult['errors'] = []

  sheet.eachRow((row, i) => {
    if (i === 1) return // skip header
    const result = schema.safeParse(rowToObject(row))
    if (result.success) rows.push(result.data)
    else errors.push({ row: i, field: result.error.issues[0].path.join('.'), reason: result.error.issues[0].message })
  })

  const imported = await upsertFn(rows)
  return { imported, skipped: rows.length - imported, errors }
}
```

**Reglas de negocio:**
- `ThirdParty`: validar unicidad `[tenantId, nit]` — skip silencioso si ya existe
- `Product`: validar unicidad `[tenantId, sku]` — skip silencioso si ya existe
- Máximo 1.000 filas por archivo (guard de tamaño)
- Rate limit específico: 5 imports/hora por tenant

---

### P0-3 · Reportes financieros — Balance General y P&G

| Atributo | Valor |
|---|---|
| **Impacto retención** | 🔴 Crítico — el contador usa estos reportes semanalmente; sin ellos el ERP pierde su valor central |
| **Impacto ingresos** | 🟠 Alto — diferenciador vs. competencia (Siigo, World Office) |
| **Esfuerzo** | M — 2 días (query aggregation + estructura de respuesta) |
| **Riesgo** | Medio — depende de que los asientos contables estén bien generados |
| **Dependencias** | `LedgerEntry` + `LedgerLine` poblados correctamente por facturas/compras |

**Módulo a crear: `src/modules/reports/`**

```
GET /api/v1/reports/balance-sheet?asOf=YYYY-MM-DD
GET /api/v1/reports/income-statement?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/reports/cash-flow?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/reports/trial-balance?from=YYYY-MM-DD&to=YYYY-MM-DD
```

**Query de balance sheet:**

```typescript
async getBalanceSheet(tenantId: string, asOf: Date) {
  const lines = await this.prisma.ledgerLine.groupBy({
    by: ['account'],
    where: { ledgerEntry: { tenantId, entryAt: { lte: asOf } } },
    _sum: { debit: true, credit: true },
  })

  // PUC Colombia: 1xxx Activo, 2xxx Pasivo, 3xxx Patrimonio
  // 4xxx Ingreso, 5xxx Costo/Gasto (van a P&G, no a balance)
  const categorize = (account: string) => {
    const prefix = account[0]
    return { '1': 'assets', '2': 'liabilities', '3': 'equity' }[prefix] ?? 'other'
  }

  return lines.reduce((acc, line) => {
    const cat = categorize(line.account)
    const net = (line._sum.debit ?? 0) - (line._sum.credit ?? 0)
    acc[cat] = acc[cat] ?? {}
    acc[cat][line.account] = net
    return acc
  }, {} as Record<string, Record<string, number>>)
}
```

**Schema de respuesta:**

```typescript
class BalanceSheetDto {
  asOf: string
  currency: 'COP'
  assets: Record<string, number>       // { '1105': 5000000, '1305': 12000000 }
  liabilities: Record<string, number>
  equity: Record<string, number>
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  balanced: boolean                    // totalAssets === totalLiabilities + totalEquity
}
```

---

### P0-4 · Demo Request API pública

| Atributo | Valor |
|---|---|
| **Impacto ingresos** | 🔴 Crítico — el botón "Solicitar Demo" no tiene backend real |
| **Esfuerzo** | XS — modelo `DemoRequest` ya existe en schema |
| **Riesgo** | Bajo |
| **Dependencias** | `NotificationService` ya existe |

**Verificar si el endpoint existe en `demo.module.ts` — si no:**

```typescript
// src/modules/demo/demo.controller.ts
@Public()
@Post('request')
@Throttle(3, 3600) // 3 solicitudes por hora por IP
async createDemoRequest(@Body() dto: CreateDemoRequestDto, @Ip() ip: string) {
  const request = await this.prisma.demoRequest.create({
    data: { ...dto, estado: 'nuevo' },
  })

  // Notificación interna al equipo comercial
  await this.notificationService.sendInternalAlert(
    `Nueva solicitud de demo: ${dto.nombre} (${dto.empresa}) — ${dto.correo}`,
  )

  // Email de confirmación al solicitante
  await this.notificationService.sendGenericEmail(
    dto.correo,
    '¡Solicitud recibida! Te contactamos en menos de 24 horas',
    `Hola ${dto.nombre}, ...`
  )

  return { ok: true, id: request.id }
}
```

---

## 🟠 P1 — Sprint 1–2 (Semanas 3–6)
> **Criterio:** Afectan activación, retención y fiabilidad operacional.

---

### P1-1 · OCR de facturas de proveedores

| Atributo | Valor |
|---|---|
| **Impacto retención** | 🟠 Alto — feature diferenciadora que justifica plan Pyme ($189k/mes) |
| **Impacto conversión** | 🟠 Alto — testimonial de landing menciona explícitamente este feature |
| **Esfuerzo** | M — 2-3 días (upload + Gemini Vision + parsing + Zod) |
| **Riesgo** | Medio — calidad de OCR depende del modelo y formato del PDF |
| **Dependencias** | S3/R2 para almacenamiento (o temporal en disco en primera iteración) |
| **Plan mínimo requerido** | `pyme` o `enterprise` |

**Endpoint:**

```
POST /api/v1/ai/ocr-upload
  Content-Type: multipart/form-data
  Guard: ActiveSubscriptionGuard (pyme+)
  Body: { file: File<PDF|PNG|JPG>, autoCreatePurchase?: boolean }
```

**Flujo:**

```
1. Validar tipo MIME y tamaño (máx 10MB)
2. Upload a S3/R2 → obtener URL firmada
3. Enviar a Gemini Vision con prompt especializado:
   "Extrae del documento: vendedor, NIT, fecha, items (descripción, cantidad, precio unitario, IVA), subtotal, total IVA, total. Responde SOLO en JSON."
4. Validar respuesta con Zod (OcrExtractedFields schema)
5. CREATE OcrRun { tenantId, source: url, fields: json, confidence, status: 'processed' }
6. Si autoCreatePurchase: crear Purchase draft con los datos extraídos
7. CREATE UsageRecord { feature: 'ocr_run' }
8. Retornar { ocrRunId, fields, confidence, purchaseId? }
```

**Schema Zod de validación de salida:**

```typescript
const OcrFieldsSchema = z.object({
  vendor:    z.string().optional(),
  vendorNit: z.string().optional(),
  date:      z.string().optional(),
  items: z.array(z.object({
    description: z.string(),
    quantity:    z.number().positive(),
    unitPrice:   z.number().nonnegative(),
    taxRate:     z.number().min(0).max(100),
    subtotal:    z.number().nonnegative(),
  })).optional(),
  subtotal: z.number().nonnegative().optional(),
  taxTotal: z.number().nonnegative().optional(),
  total:    z.number().positive().optional(),
})
```

**Modificación al schema Prisma:**

```prisma
model OcrRun {
  // campos actuales...
  purchaseId String?  @unique
  status     String   @default("pending") // pending | processed | failed
  fileUrl    String?
  purchase   Purchase? @relation(fields: [purchaseId], references: [id], onDelete: SetNull)

  @@index([tenantId, status])
}

model Purchase {
  // campos actuales...
  ocrRun OcrRun?
}
```

---

### P1-2 · Financial Advisor IA

| Atributo | Valor |
|---|---|
| **Impacto retención** | 🟠 Alto — el usuario recibe valor activo sin pedirlo (diferenciador ContexAI) |
| **Esfuerzo** | M — 2 días |
| **Riesgo** | Medio — calidad del análisis depende de datos contables correctos |
| **Dependencias** | P0-3 (reportes financieros deben existir primero) |

```
POST /api/v1/ai/financial-advisor
  Guard: ActiveSubscriptionGuard (pyme+)
  Body: { period: 'last-month' | 'last-quarter' | 'ytd', query?: string }
```

**Reglas de seguridad obligatorias (backend-product-rules.md):**

```typescript
private sanitizeForLLM(data: FinancialContext): SanitizedContext {
  // Eliminar NITs, nombres reales, emails antes de enviar al LLM
  return {
    ...data,
    thirdParties: data.thirdParties.map((t, i) => ({
      ...t,
      name: `Cliente_${i + 1}`,
      nit: 'REDACTED',
      email: 'REDACTED',
    })),
  }
}
```

**Rate limiting específico IA:**

```typescript
@Throttle(20, 86400) // 20 consultas/día por tenant
@UseGuards(AiQuotaGuard) // valida UsageRecord { feature: 'ai_query' } < plan.maxAiQueries
```

---

### P1-3 · Conciliación bancaria

| Atributo | Valor |
|---|---|
| **Impacto retención** | 🟠 Alto — contadores necesitan esta feature semanalmente |
| **Esfuerzo** | S — 1 día |
| **Riesgo** | Bajo |
| **Dependencias** | `Transaction` y `LedgerEntry` models — ambos existen |

```typescript
// POST /api/v1/treasury/reconcile
async reconcile(tenantId: string, dto: ReconcileDto) {
  // Validar aislamiento multi-tenant de cada ID
  const transactions = await this.prisma.transaction.findMany({
    where: { id: { in: dto.transactionIds }, tenantId },
  })
  if (transactions.length !== dto.transactionIds.length) {
    throw new ForbiddenException('Algunos registros no pertenecen a este tenant')
  }

  await this.prisma.$transaction([
    this.prisma.ledgerEntry.update({
      where: { id: dto.ledgerEntryId, tenantId },
      data: { reconciled: true, reconciledAt: new Date() },
    }),
    // Crear AuditEvent
    this.prisma.auditEvent.create({
      data: { tenantId, entity: 'ledger', action: 'reconcile', ... }
    }),
  ])

  return { reconciled: transactions.length }
}
```

---

### P1-4 · Alertas operacionales automáticas

| Atributo | Valor |
|---|---|
| **Impacto retención** | 🔴 Crítico — sin alertas, el cliente descubre el problema cuando ya tiene multa de la DIAN |
| **Esfuerzo** | S — 1 día (schedulers + email templates) |
| **Riesgo** | Bajo |

**Crons a implementar:**

```typescript
// src/modules/dian/dian.scheduler.ts
@Cron('0 9 * * *')
async checkResolutionExpiry() {
  const tenants = await this.prisma.tenant.findMany({
    where: {
      resolutionTo: { lte: addDays(new Date(), 30) },
      dianStatus: { not: null },
    },
    include: { memberships: { include: { user: true } } },
  })
  for (const tenant of tenants) {
    const daysLeft = differenceInDays(tenant.resolutionTo, new Date())
    const admin = tenant.memberships.find(m => m.role === 'Administrador')?.user
    if (admin) {
      await this.mailer.sendResolutionExpiryAlert(admin.email, tenant.name, daysLeft)
    }
  }
}

// src/modules/subscriptions/dunning.scheduler.ts (ya existe — añadir:)
@Cron('0 10 * * *')
async checkTrialExpiry() {
  const expiring = await this.prisma.subscription.findMany({
    where: {
      trialEndsAt: { lte: addDays(new Date(), 3), gte: new Date() },
    },
    include: { tenant: { include: { memberships: { include: { user: true } } } } },
  })
  for (const sub of expiring) {
    const daysLeft = differenceInDays(sub.trialEndsAt, new Date())
    // Enviar email urgente de fin de trial
  }
}
```

**Campos a añadir al schema:**

```prisma
model Tenant {
  // nuevos campos
  dianResolutionAlertThreshold Int     @default(50)
  onboardingStep               String  @default("company_info")
}
```

---

### P1-5 · Onboarding step-by-step tracking

| Atributo | Valor |
|---|---|
| **Impacto activación** | 🟠 Alto — el 80% del churn ocurre en la primera semana si el usuario no completa el setup |
| **Esfuerzo** | S — 1 día |
| **Dependencias** | Campo `onboardingStep` en Tenant (P1-4) |

**Endpoints nuevos:**

```
POST /api/v1/onboarding/step       Body: { step: string }
GET  /api/v1/onboarding/checklist  → estado de cada paso
```

**Checklist automático (calculado, no almacenado):**

```typescript
async getChecklist(tenantId: string) {
  const [tenant, products, thirdParties, invoices] = await Promise.all([
    this.prisma.tenant.findUnique({ where: { id: tenantId } }),
    this.prisma.product.count({ where: { tenantId } }),
    this.prisma.thirdParty.count({ where: { tenantId } }),
    this.prisma.invoice.count({ where: { tenantId } }),
  ])

  return {
    companyConfigured: !!tenant?.nit && !!tenant?.address,
    dianConfigured:    !!tenant?.dianCertificate && !!tenant?.invoiceResolution,
    firstProduct:      products > 0,
    firstClient:       thirdParties > 0,
    firstInvoice:      invoices > 0,
    percentComplete:   calculatePercent([...]),
  }
}
```

---

## 🟡 P2 — Sprint 3–4 (Semanas 7–10)
> **Criterio:** Bloquean escalabilidad o afectan seguridad en producción real.

---

### P2-1 · Bull queues para emisión DIAN asíncrona

| Atributo | Valor |
|---|---|
| **Riesgo escalabilidad** | 🔴 Crítico — emisión DIAN síncrona en request HTTP bloquea Event Loop bajo carga |
| **Esfuerzo** | M — 2 días |
| **Dependencias** | Redis (ya puede estar presente si se hace P2-3 primero) |

**Por qué es urgente:** Con 200 facturas/día (testimonial de landing), y cada emisión DIAN tomando 3-10 segundos, a hora pico (11am–2pm) se generan cuellos de botella que degradan toda la API.

**Arquitectura de colas:**

```
Emisión HTTP → InvoicesService.emit() → dianQueue.add('emit', job) → HTTP responde 202
                                                  ↓
                                         DianProcessor.emit()  (worker separado)
                                                  ↓
                                    Reintentos: 5 intentos, backoff exponencial
                                                  ↓
                                    WebSocket / SSE → frontend actualiza estado
```

```typescript
// src/modules/dian/dian.queue.ts
@Processor('dian-invoice')
export class DianInvoiceProcessor {
  @Process('emit')
  async emit(job: Job<{ invoiceId: string; tenantId: string }>) {
    const { invoiceId, tenantId } = job.data
    // lógica de firma XML + envío DIAN
    // UPDATE invoice.status, invoice.timeline
    // Si falla: job.attemptsMade < 5 → reencolar con backoff
  }
}

// bull config
dianQueue.add('emit', payload, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: 100, // conservar últimos 100
  removeOnFail: 500,
})
```

**Endpoint de estado de emisión:**

```
GET /api/v1/invoices/:id/emission-status
  → { status: 'queued' | 'processing' | 'emitted' | 'failed', cufe?, errorMessage? }
```

---

### P2-2 · Normalización stock multi-bodega

| Atributo | Valor |
|---|---|
| **Riesgo escalabilidad** | 🟠 Alto — `stockByLocation: Json` no permite queries SQL eficientes |
| **Impacto retención** | 🟠 Alto — "inventario multi-bodega" es feature central prometida en landing |
| **Esfuerzo** | L — 3 días (migration + backfill + queries nuevas) |
| **Riesgo** | Alto — migration en tabla con datos de producción |

**Migration strategy:**

```prisma
// Paso 1: Añadir nueva tabla
model ProductLocationStock {
  id         String  @id @default(cuid())
  tenantId   String
  productId  String
  locationId String
  quantity   Int     @default(0)
  updatedAt  DateTime @updatedAt

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, locationId])
  @@index([tenantId, locationId])
  @@index([productId])
}

// Paso 2: Mantener Product.stockByLocation temporalmente (deprecated)
// Paso 3: Script de backfill desde JSON → tabla nueva
// Paso 4: En una release posterior, eliminar Product.stockByLocation
```

**Endpoints nuevos:**

```
GET  /api/v1/inventory/by-location?locationId=X
GET  /api/v1/inventory/locations          → lista bodegas disponibles del tenant
POST /api/v1/inventory/adjust-stock       Body: { productId, locationId, quantity, reason }
```

---

### P2-3 · Redis rate limiting multi-instancia

| Atributo | Valor |
|---|---|
| **Riesgo seguridad** | 🟠 Alto — en despliegue multi-instancia (Railway), el throttle en memoria es inútil |
| **Esfuerzo** | XS — cambio de configuración en `app.module.ts` |
| **Dependencias** | Redis (Upstash o Railway Redis) |

```typescript
// app.module.ts
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis'

ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    storage: new ThrottlerStorageRedisService({
      host: config.get('REDIS_HOST'),
      port: config.get('REDIS_PORT'),
      password: config.get('REDIS_PASSWORD'),
    }),
    throttlers: [
      { name: 'global',  ttl: 60000,  limit: 100 },
      { name: 'auth',    ttl: 60000,  limit: 5   },   // login, reset-password
      { name: 'ai',      ttl: 86400000, limit: 20 },  // queries IA por día
      { name: 'import',  ttl: 3600000, limit: 5   },  // imports Excel por hora
    ],
  }),
})
```

---

### P2-4 · Webhook delivery service

| Atributo | Valor |
|---|---|
| **Impacto ecosistema** | 🟡 Medio — habilita integraciones con sistemas externos del cliente |
| **Esfuerzo** | M — 2 días |
| **Dependencias** | `Webhook` model ya existe en schema |

**Eventos a implementar primero:**

| Evento | Trigger |
|---|---|
| `invoice.emitted` | Invoice status → emitted |
| `invoice.cancelled` | Invoice status → cancelled |
| `payment.approved` | Wompi webhook approved |
| `subscription.activated` | Suscripción activada |
| `subscription.cancelled` | Suscripción cancelada |
| `stock.low` | Stock < minStock |

```typescript
// src/modules/webhooks/webhook-dispatcher.service.ts
@Injectable()
export class WebhookDispatcherService {
  async dispatch(tenantId: string, event: string, payload: object) {
    const hooks = await this.prisma.webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
    })

    await Promise.allSettled(
      hooks.map(hook => this.deliver(hook, event, payload))
    )
  }

  private async deliver(hook: Webhook, event: string, payload: object) {
    const body = JSON.stringify({ event, data: payload, timestamp: new Date() })
    const sig = createHmac('sha256', hook.secret ?? '').update(body).digest('hex')

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Contex360-Signature': `sha256=${sig}`,
          'X-Contex360-Event': event,
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          lastSent: new Date(),
          lastStatus: String(res.status),
          retryCount: res.ok ? 0 : { increment: 1 },
        },
      })
    } catch (err) {
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: { lastStatus: 'error', retryCount: { increment: 1 } },
      })
      // Deshabilitar si >10 fallos consecutivos
      if (hook.retryCount >= 9) {
        await this.prisma.webhook.update({
          where: { id: hook.id },
          data: { active: false },
        })
      }
    }
  }
}
```

---

### P2-5 · S3/R2 para archivos OCR

| Atributo | Valor |
|---|---|
| **Riesgo infraestructura** | 🔴 Crítico si OCR (P1-1) se implementa sin esto — archivos se pierden en cada redeploy |
| **Esfuerzo** | S — 1 día (configurar Cloudflare R2 o AWS S3) |
| **Dependencias** | Se debe hacer antes o junto con P1-1 |

```typescript
// src/common/storage/r2-storage.service.ts
@Injectable()
export class R2StorageService {
  private s3: S3Client

  constructor() {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }))
    return `${process.env.R2_PUBLIC_URL}/${key}`
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: key,
    }), { expiresIn })
  }
}
```

---

## 🔵 P3 — Sprint 5 (Semanas 11–12)
> **Criterio:** Expansión, ecosystem y madurez enterprise.

---

### P3-1 · Conector de migración Siigo

| Atributo | Valor |
|---|---|
| **Impacto conversión** | 🟡 Medio — promise en FAQ ("migraciones desde Siigo sin costo adicional") |
| **Esfuerzo** | XL — 4-5 días (API de Siigo + mapeo de datos) |
| **Riesgo** | Alto — API de Siigo puede cambiar sin aviso |

```
POST /api/v1/onboarding/migrate/siigo
  Body: { clientId: string, clientSecret: string, companyId: string }
  → OAuth con Siigo API
  → Extraer: Clientes, Proveedores, Productos, Inventario, Cuentas
  → Mapear a schema Contex360
  → Crear job de migración con progreso (polling endpoint)
  → Email al completar con resumen

GET /api/v1/onboarding/migrate/:jobId/status
  → { status: 'running' | 'completed' | 'failed', progress: 45, imported: {...} }
```

---

### P3-2 · Trial management completo

| Atributo | Valor |
|---|---|
| **Impacto ingresos** | 🟠 Alto — emails de conversión de trial son el canal de mayor ROI en SaaS |
| **Esfuerzo** | S — 1 día (templates + scheduler) |

**Secuencia de emails de trial:**

```
Día 1  → Email de bienvenida (ya implementado en sendWelcomeEmail)
Día 7  → "¿Cómo va tu experiencia?" — NPS rápido
Día 11 → "Te quedan 3 días de trial" — urgencia + beneficios del plan Pyme
Día 13 → "Mañana termina tu trial" — CTA directo a checkout
Día 14 → Trial expirado — acceso limitado, no bloqueado, con banner
Día 21 → "¿Qué te detuvo?" — recuperación con oferta especial
```

---

### P3-3 · Analytics de conversión del landing

| Atributo | Valor |
|---|---|
| **Impacto growth** | 🟡 Medio — sin datos no se puede optimizar conversión |
| **Esfuerzo** | XS — 1 endpoint público simple |

```typescript
// POST /api/v1/public/analytics/event  [Public, rate-limited: 30/min por IP]
async trackEvent(@Body() dto: TrackEventDto, @Ip() ip: string) {
  // NO guardar en DB — forward a PostHog / Plausible
  // O guardar en tabla EventLog si se prefiere self-hosted
  await this.analyticsService.track({
    event: dto.event,
    source: dto.source,
    plan: dto.plan,
    sessionId: dto.sessionId,
    ip: hashIp(ip), // anonimizar para GDPR/Habeas Data
  })
  return { ok: true }
}
```

---

### P3-4 · Status page pública

| Atributo | Valor |
|---|---|
| **Impacto confianza** | 🟡 Medio — demostrable ante clientes enterprise en proceso de compra |
| **Esfuerzo** | XS — modelos ya existen (`UptimeEvent`, `Incident`) |

```
GET /api/v1/public/status  [Public, cache: 30s]
  → { status: 'operational' | 'degraded' | 'down', latencyMs, incidents: [...] }
```

---

## ⚡ Quick Wins — Sin sprint propio (< 4 horas cada uno)

| ID | Tarea | Impacto | Esfuerzo |
|---|---|---|---|
| QW-1 | Reset mensual de `invoicesThisMonth` en subscription scheduler | 🔴 Billing | 30 min |
| QW-2 | `Tenant.dianResolutionAlertThreshold` + `onboardingStep` en schema | 🟠 Operacional | 15 min |
| QW-3 | `OcrRun.purchaseId` + `status` + `fileUrl` en schema | 🟠 Feature | 15 min |
| QW-4 | `GET /api/v1/public/status` con `UptimeEvent` | 🟡 Confianza | 1 hora |
| QW-5 | Parámetro `?include=items` en `GET /invoices` (evita N+1) | 🟠 Performance | 30 min |
| QW-6 | `GET /api/v1/onboarding/checklist` (calculado, sin migrations) | 🟠 Activación | 2 horas |
| QW-7 | Rate limit específico para `/auth/login` y `/auth/reset-password` (ya en reglas, verificar aplicación) | 🔴 Seguridad | 15 min |

---

## 🏗️ Arquitectura recomendada (estado objetivo, Semana 12)

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTE / LANDING                        │
│           Vue 3 + Tailwind · businessApi (fetch)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────────┐
│                     API GATEWAY (NestJS)                         │
│  Rate Limit (Redis) · AuthGuard · PermissionsGuard · TenantId   │
│  ThrottlerModule · Pino Logger · Correlation-ID Middleware       │
└──┬─────────┬────────────┬──────────┬──────────┬────────────────┘
   │         │            │          │          │
   ▼         ▼            ▼          ▼          ▼
┌──────┐ ┌──────────┐ ┌───────┐ ┌──────┐ ┌──────────────┐
│ Auth │ │Invoices  │ │Reports│ │  AI  │ │Subscriptions │
│ 2FA  │ │Purchases │ │Balance│ │ OCR  │ │Wompi Webhook │
│ JWT  │ │Products  │ │  P&G  │ │Chat  │ │Dunning Cron  │
└──────┘ │Inventory │ │ CF    │ │Adv.  │ │Trial Emails  │
         │ThirdParty│ └───────┘ └──┬───┘ └──────────────┘
         └──────────┘              │
                                   │ Gemini/Groq API
                                   │ (datos anonimizados)
┌──────────────────────────────────▼──────────────────────────────┐
│                        COLA ASÍNCRONA (Bull + Redis)             │
│         DianQueue · EmailQueue · WebhookQueue · OcrQueue         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     ALMACENAMIENTO                               │
│  PostgreSQL (Neon) · Cloudflare R2 (archivos) · Redis (cache)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚨 Riesgos de escalabilidad — Ranking

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| 1 | DIAN síncrona bloquea Event Loop | Alta (con crecimiento) | Crítico | P2-1: Bull queues |
| 2 | Rate limiting en memoria en multi-instancia | Alta | Alto | P2-3: Redis throttler |
| 3 | `stockByLocation: Json` → queries lentas con catálogos grandes | Media | Alto | P2-2: Normalizar tabla |
| 4 | Archivos OCR en disco → pérdida en redeploy | Alta (si OCR activo) | Alto | P2-5: S3/R2 |
| 5 | Webhook de Wompi sin idempotencia doble (concurrent requests) | Baja (ya mitigado con P2002 catch) | Crítico | Verificar constraint único |
| 6 | `$queryRaw` en reportes sin `tenantId` → fuga de datos | Media | Crítico | Prisma middleware global |

---

## 📐 Variables de entorno a añadir

```bash
# Redis
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

# Cloudflare R2
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=contex360-uploads
R2_PUBLIC_URL=https://files.contex360.com

# Analytics (opcional)
POSTHOG_API_KEY=
POSTHOG_HOST=

# Siigo (migración)
SIIGO_BASE_URL=https://api.siigo.com
```

---

## 📅 Roadmap visual de 12 semanas

```
           S1    S2    S3    S4    S5    S6    S7    S8    S9   S10   S11   S12
P0-1 Quota  ████
P0-2 Import ████ ████
P0-3 Reports ████ ████
P0-4 Demo        ████
P1-1 OCR               ████ ████
P1-2 FinAdv                   ████ ████
P1-3 Reconcile                     ████
P1-4 Alertas                       ████
P1-5 Onboard                            ████
P2-1 BullQ                              ████ ████
P2-2 Stock                                   ████ ████
P2-3 Redis                                         ████
P2-4 Webhooks                                      ████
P2-5 S3/R2   ████ ████ (junto con OCR en P1-1)
P3-1 Siigo                                              ████ ████
P3-2 Trial                                              ████
P3-3 Analytics                                               ████
P3-4 Status                                                  ████
QWs  ████ (todos al inicio del Sprint 0)
```

---

## ✅ Definición de "done" por sprint

| Sprint | Done cuando... |
|---|---|
| S0 (P0) | Starter no puede crear factura 51. Demo form funciona. Excel import sube sin errores. Balance sheet retorna JSON válido. |
| S1 (P1a) | OCR procesa PDF real de proveedor. Purchase draft creado automáticamente. Financial advisor responde análisis coherente. |
| S2 (P1b) | Conciliación marca LedgerEntry.reconciled. Alertas DIAN enviadas 30 días antes. Checklist de onboarding retorna 5 items. |
| S3 (P2a) | Factura DIAN se emite en background. Redis throttler activo. OCR files en R2 sobreviven redeploy. |
| S4 (P2b) | Stock consultable por bodega en SQL. Webhook dispara en invoice.emitted con firma. |
| S5 (P3) | Import Siigo completa sin errores para empresa demo. Trial emails enviados en secuencia correcta. |

---

*Este roadmap debe revisarse mensualmente contra métricas reales de activación, churn y uso de features por tenant.*
