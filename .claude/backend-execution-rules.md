# Backend Execution Rules — Contex360 ERP
**Versión:** 2.0 — Mayo 2026  
**Alcance:** Todo agente (Claude Code, Antigravity, humano) que toque código backend.  
**Precedencia:** Estas reglas son ejecutables y específicas al código real del proyecto. Complementan `backend-rules.md` y `backend-product-rules.md` y los reemplazan en caso de conflicto operativo.

---

> ## ⚠️ Regla meta — LEER ANTES DE ESCRIBIR UNA SOLA LÍNEA
>
> 1. Leer este archivo completo.
> 2. Leer el schema Prisma (`prisma/schema.prisma`) para entender los modelos existentes.
> 3. Leer el módulo más cercano al feature que vas a construir.
> 4. No inventar patrones nuevos. Si los patrones de este documento son suficientes, usarlos.
> 5. Si una decisión no está cubierta aquí, escalar al CTO antes de improvisar.

---

## Índice

**Arquitectura**
1. [Estructura de módulo](#1-estructura-de-módulo)
2. [Controller — capa HTTP pura](#2-controller--capa-http-pura)
3. [Service — capa de negocio](#3-service--capa-de-negocio)
4. [Tipos de respuesta](#4-tipos-de-respuesta)

**Seguridad y multi-tenancy**
5. [Multi-tenancy — ley absoluta](#5-multi-tenancy--ley-absoluta)
6. [Guards y decoradores](#6-guards-y-decoradores)
7. [Rate limiting](#7-rate-limiting)
8. [Endpoints públicos](#8-endpoints-públicos)

**Datos**
9. [DTOs y validación con class-validator](#9-dtos-y-validación-con-class-validator)
10. [Zod — validación de salidas externas](#10-zod--validación-de-salidas-externas)
11. [Prisma — patrones y antipatrones](#11-prisma--patrones-y-antipatrones)
12. [Paginación](#12-paginación)
13. [Transacciones](#13-transacciones)
14. [Migrations de schema](#14-migrations-de-schema)

**Operaciones**
15. [Cuotas y límites de plan](#15-cuotas-y-límites-de-plan)
16. [Ledger contable — asientos automáticos](#16-ledger-contable--asientos-automáticos)
17. [AuditEvent — trazabilidad](#17-auditevent--trazabilidad)
18. [Manejo de errores](#18-manejo-de-errores)
19. [Logging con Pino](#19-logging-con-pino)

**Procesamiento asíncrono**
20. [Colas y background jobs](#20-colas-y-background-jobs)
21. [Crons y schedulers](#21-crons-y-schedulers)
22. [Event-driven dentro del proceso](#22-event-driven-dentro-del-proceso)

**Dominios especiales**
23. [IA — ContexAI](#23-ia--contexai)
24. [OCR y procesamiento de archivos](#24-ocr-y-procesamiento-de-archivos)
25. [Uploads — archivos en S3/R2](#25-uploads--archivos-en-s3r2)
26. [Billing — Wompi y suscripciones](#26-billing--wompi-y-suscripciones)
27. [DIAN — facturación electrónica](#27-dian--facturación-electrónica)
28. [Webhooks salientes](#28-webhooks-salientes)

**Calidad**
29. [Observabilidad y métricas](#29-observabilidad-y-métricas)
30. [Testing — contrato mínimo](#30-testing--contrato-mínimo)
31. [Variables de entorno](#31-variables-de-entorno)
32. [Checklist pre-commit](#32-checklist-pre-commit)

---

## 1. Estructura de módulo

Todo módulo sigue esta estructura sin variaciones. Copiar exactamente.

```
src/modules/<nombre>/
  ├── <nombre>.module.ts         ← NestJS @Module: imports, providers, exports
  ├── <nombre>.controller.ts     ← HTTP layer: routing, validación de entrada, nada más
  ├── <nombre>.service.ts        ← Toda la lógica de negocio
  ├── <nombre>.dto.ts            ← DTOs de entrada (class-validator)
  ├── <nombre>.types.ts          ← Interfaces TypeScript de respuesta (no DTOs)
  └── <nombre>.service.spec.ts   ← Tests unitarios del service (obligatorio)
```

**Extensiones opcionales según necesidad:**

```
  ├── <nombre>.scheduler.ts      ← Solo @Cron, delega 100% al service
  ├── <nombre>.processor.ts      ← Bull queue processor
  ├── <nombre>.mailer.ts         ← Emails específicos del módulo
  └── dto/                       ← Si hay más de 5 DTOs distintos
      ├── create-<nombre>.dto.ts
      ├── update-<nombre>.dto.ts
      └── query-<nombre>.dto.ts
```

**Reglas de módulo:**

- Todo módulo nuevo se registra en el array `imports` de `AppModule`. Sin esto no existe.
- Los módulos se comunican solo por inyección de dependencias, nunca con imports circulares.
- Si dos módulos se necesitan mutuamente, extraer la funcionalidad compartida a un tercer módulo (`common/`) o usar `EventEmitterModule`.
- `PrismaModule` se importa en todos los módulos que accedan a BD.
- `UsageModule` se importa en todos los módulos que registren uso de features.

---

## 2. Controller — capa HTTP pura

El controller **no contiene lógica de negocio**. Su única responsabilidad es: recibir la request HTTP, extraer parámetros validados, llamar al service, retornar el resultado.

### Declaración estándar

```typescript
import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { TenantId } from '../../common/decorators/tenant.decorator'
import { AuthUser } from '../../common/decorators/auth-user.decorator'
import { AuthTokenPayload } from '../auth/auth.types'
import { ReportsService } from './reports.service'
import { BalanceSheetQueryDto } from './reports.dto'

@Controller('reports')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name)

  constructor(private readonly reportsService: ReportsService) {}

  @Get('balance-sheet')
  getBalanceSheet(
    @TenantId() tenantId: string,
    @Query() query: BalanceSheetQueryDto,
  ) {
    return this.reportsService.getBalanceSheet(tenantId, query)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @TenantId() tenantId: string,
    @AuthUser() user: AuthTokenPayload,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(tenantId, user.sub, dto)
  }
}
```

### ❌ Lo que NUNCA va en un controller

```typescript
// ❌ Lógica de negocio
const total = items.reduce((s, i) => s + i.price, 0)

// ❌ Acceso directo a Prisma (salvo excepción documentada)
const invoice = await this.prisma.invoice.findMany(...)

// ❌ Leer req.headers manualmente para obtener el tenant
const tenantId = req.headers['x-tenant-id']  // usar @TenantId() en su lugar

// ❌ Cálculos, transformaciones, validaciones de negocio
if (plan.maxUsers !== null && users.length >= plan.maxUsers) { ... }

// ❌ Llamadas a APIs externas
const response = await fetch('https://api.dian.gov.co/...')
```

---

## 3. Service — capa de negocio

El service contiene **toda** la lógica. No hay excepciones.

### Declaración estándar

```typescript
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly usageService: UsageService,
    private readonly config: ConfigService,
  ) {}
}
```

### Orden canónico de operaciones en un método de escritura

Seguir este orden **siempre** dentro de `prisma.$transaction()`:

```
1.  Verificar que el tenant existe (findUnique por id)
2.  Verificar cuota del plan (UsageService.checkLimit) → lanzar ForbiddenException si excede
3.  Validar reglas de negocio (unicidad, stock, relaciones)
4.  Crear / actualizar el registro principal
5.  Efectos secundarios atómicos (stock, ledger, contadores)
6.  Registrar UsageService.recordUsage()
──── FIN DE $transaction ────────────────────────────────────────────
7.  (post-transacción) Crear AuditEvent — tolerante a fallos
8.  (post-transacción) Disparar webhooks — tolerante a fallos
9.  (post-transacción) Enviar emails — tolerante a fallos
10. (post-transacción) Encolar jobs de DIAN / OCR — si aplica
```

### ✅ Ejemplo completo correcto

```typescript
async create(tenantId: string, userId: string, dto: CreateInvoiceDto) {
  let invoice: Invoice

  // Pasos 1–6: atómicos
  invoice = await this.prisma.$transaction(async (tx) => {
    // 1. Validar tenant
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Empresa no encontrada')

    // 2. Verificar cuota
    const quota = await this.usageService.checkLimit(tenantId, 'invoice_created')
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Límite de ${quota.limit} facturas/mes alcanzado. ` +
        `Actualiza tu plan en Configuración → Suscripción.`
      )
    }

    // 3. Validar cliente existe y pertenece al tenant
    const client = await tx.thirdParty.findFirst({
      where: { id: dto.clientId, tenantId },
    })
    if (!client) throw new NotFoundException('Cliente no encontrado')

    // 4. Crear factura
    const number = await this.generateInvoiceNumber(tx, tenantId)
    const inv = await tx.invoice.create({
      data: { tenantId, clientId: dto.clientId, number, ...computed },
      include: { items: true, client: true },
    })

    // 5. Efectos secundarios atómicos
    await this.decrementStock(tx, tenantId, dto.items)
    await this.ledger.create(tenantId, buildLedgerEntry(inv), tx)

    // 6. Registrar uso
    await this.usageService.recordUsage(tenantId, 'invoice_created')

    return inv
  })

  // 7. Audit (post-transacción, tolerante a fallos)
  this.createAudit(tenantId, userId, 'invoice', 'Factura creada', `Factura ${invoice.number}`)

  // 8. Webhooks (post-transacción)
  this.webhookDispatcher.dispatch(tenantId, 'invoice.created', { id: invoice.id, number: invoice.number })

  // 9. Email al cliente (post-transacción)
  this.invoiceMailer.sendInvoiceEmail(invoice.id).catch(e =>
    this.logger.warn(`Email de factura ${invoice.id} no enviado: ${e.message}`)
  )

  return invoice
}
```

---

## 4. Tipos de respuesta

### Tipar las respuestas de service — no retornar `any`

```typescript
// reports.types.ts
export interface BalanceSheetResponse {
  asOf: string
  currency: 'COP'
  assets: Record<string, number>
  liabilities: Record<string, number>
  equity: Record<string, number>
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  balanced: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
```

### El service retorna el tipo explícito — nunca `Promise<any>`

```typescript
// ✅ Correcto
async getBalanceSheet(tenantId: string, asOf: Date): Promise<BalanceSheetResponse> { ... }

// ❌ Incorrecto
async getBalanceSheet(tenantId: string, asOf: Date): Promise<any> { ... }
async getBalanceSheet(tenantId: string, asOf: Date) { ... }  // implicit any
```

### Nunca exponer campos sensibles en respuestas

```typescript
// ✅ Seleccionar solo lo necesario
const user = await this.prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true, status: true, createdAt: true },
  // NUNCA: passwordHash, passwordSalt, totpSecret, dianCertificate, dianCertificatePassword
})

// ✅ O mapear explícitamente antes de retornar
return {
  id: tenant.id,
  name: tenant.name,
  nit: tenant.nit,
  // Omitir: dianCertificate, smtpPassword, dianSoftwarePin
}
```

---

## 5. Multi-tenancy — ley absoluta

**Esta es la regla de seguridad más importante del sistema.** Una sola query sin `tenantId` puede exponer datos de todos los clientes.

### Regla cardinal

> **Todo** query que toque datos de negocio (Invoice, Product, ThirdParty, Purchase, LedgerEntry, LedgerLine, Transaction, OcrRun, InventoryMovement, Quote, UsageRecord, AuditEvent, Webhook, ApiKey) **debe** incluir `tenantId` en el `where`. Sin excepción.

### ✅ Correcto

```typescript
// findFirst cuando id + tenantId no son @unique juntos
const invoice = await this.prisma.invoice.findFirst({
  where: { id, tenantId },
})
if (!invoice) throw new NotFoundException('Factura no encontrada')

// findUnique cuando hay @@unique([tenantId, sku])
const product = await this.prisma.product.findUnique({
  where: { tenantId_sku: { tenantId, sku } },
})
```

### ❌ Catástrofe — NUNCA hacer esto

```typescript
// FUGA DE DATOS: expone facturas de otros tenants
const invoice = await this.prisma.invoice.findUnique({ where: { id } })

// FUGA: retorna productos de todos los tenants
const products = await this.prisma.product.findMany()

// FUGA en raw query: sin filtro de tenant
const rows = await this.prisma.$queryRaw`SELECT * FROM "Invoice" WHERE id = ${id}`
```

### En `$queryRaw` — parametrizar obligatoriamente

```typescript
// ✅ Template literal de Prisma parametriza automáticamente
const rows = await this.prisma.$queryRaw<LedgerAggRow[]>`
  SELECT ll.account, SUM(ll.debit) AS total_debit, SUM(ll.credit) AS total_credit
  FROM "LedgerLine" ll
  JOIN "LedgerEntry" le ON ll."ledgerEntryId" = le.id
  WHERE le."tenantId" = ${tenantId}
    AND le."entryAt" <= ${asOf}
  GROUP BY ll.account
`

// ❌ PROHIBIDO: concatenación de strings = SQL injection
const rows = await this.prisma.$queryRawUnsafe(
  `SELECT * FROM "Invoice" WHERE "tenantId" = '${tenantId}'`
)
```

### Validar ownership antes de mutar

```typescript
// Patrón: buscar con tenantId → lanza 404 si no pertenece al tenant
private async findOwnedOrFail<T>(
  model: any,
  id: string,
  tenantId: string,
  entityName: string,
): Promise<T> {
  const record = await model.findFirst({ where: { id, tenantId } })
  if (!record) throw new NotFoundException(`${entityName} no encontrado`)
  return record
}
```

---

## 6. Guards y decoradores

### Guards globales ya activos en `AppModule` — no añadir de nuevo

| Guard | Ya activo | Qué hace |
|---|---|---|
| `ThrottlerGuard` | ✅ Global | Rate limiting por IP |
| `TenantRateLimitGuard` | ✅ Global | Rate limiting adicional por tenant |
| `TwoFactorGuard` | ✅ Global | Requiere 2FA si está habilitado en el tenant |
| `OnboardingGuard` | ✅ Global | Bloquea si onboarding incompleto |
| `ActiveSubscriptionGuard` | ✅ Global | Bloquea si suscripción inactiva o trial expirado |
| `PlanGuard` | ✅ Global | Verifica plan mínimo requerido |

### Guards que SÍ se añaden por endpoint/controller

```typescript
// En toda clase controller autenticada:
@UseGuards(AuthGuard, PermissionsGuard)

// PermissionsGuard verifica el rol del usuario en el tenant activo.
// AuthGuard valida JWT (cookie o Bearer header).
```

### Decoradores de identidad — única fuente de verdad

```typescript
@TenantId() tenantId: string
// Lee: header 'x-tenant-id' primero, luego request.authUser.tenantId
// NUNCA: req.headers['x-tenant-id'] directamente

@AuthUser() user: AuthTokenPayload
// Lee: request.authUser (seteado por AuthGuard)
// Payload: { sub: string, email: string, isSystemOwner: boolean, tenantIds: string[] }
```

### Decoradores de exención

```typescript
@Public()            // Importar de '../auth/public.decorator' — endpoint sin auth
@SkipOnboardingCheck()  // Para endpoints dentro del propio módulo onboarding
```

---

## 7. Rate limiting

### Throttle global ya configurado en `AppModule`

```typescript
ThrottlerModule.forRoot([
  { name: 'short', ttl: 60000,   limit: 30  },  // 30 req/min
  { name: 'long',  ttl: 3600000, limit: 300 },  // 300 req/hora
])
```

### Throttle específico por endpoint — cuándo y cómo

Los endpoints sensibles requieren límites adicionales **más estrictos** con `@Throttle()`:

```typescript
// Endpoints de auth — muy restrictivos
@Throttle({ short: { ttl: 60000, limit: 5 } })
@Post('login')
async login(...) {}

// Endpoints públicos de captación de leads
@Throttle({ short: { ttl: 3600000, limit: 3 } })  // 3 por hora
@Public()
@Post('demo/request')
async demoRequest(...) {}

// Endpoints de IA — costosos
@Throttle({ short: { ttl: 60000, limit: 10 } })
@Post('ai/chat')
async chat(...) {}

// Endpoints de upload — pesados
@Throttle({ short: { ttl: 60000, limit: 5 } })
@Post('ai/ocr-upload')
async ocrUpload(...) {}

// Endpoints de import masivo
@Throttle({ short: { ttl: 3600000, limit: 5 } })  // 5 imports por hora
@Post('onboarding/import/products')
async importProducts(...) {}
```

### Regla: rate limiting en memoria ≠ multi-instancia

En despliegue con múltiples instancias (Railway auto-scale), el throttle en memoria no se comparte. Cuando se configure Redis, migrar a `ThrottlerStorageRedisService`. Por ahora, documentar el riesgo y no eliminar el throttle actual.

---

## 8. Endpoints públicos

Todo endpoint `@Public()` debe cumplir estos 9 puntos **antes de hacer merge**:

```
✅ 1. @Throttle() explícito — mínimo 3-5 req/min por IP para mutaciones
✅ 2. DTO validado con class-validator (whitelist global ya activo)
✅ 3. Respuesta genérica — nunca revelar si un email/NIT ya existe
✅ 4. No retornar IDs internos de BD, tenantIds, ni configuraciones
✅ 5. Si recibe texto libre: sanitizar XSS antes de persistir
✅ 6. Si recibe archivos: validar MIME type y tamaño (no confiar en Content-Type)
✅ 7. Si crea registros: idempotencia o unicidad verificada
✅ 8. Loggear cada invocación con IP anonimizada (primeros 2 octetos)
✅ 9. Nunca lanzar stack traces en producción (AllExceptionsFilter ya lo maneja)
```

---

## 9. DTOs y validación con class-validator

### Todo endpoint POST/PUT/PATCH tiene un DTO — sin excepciones

```typescript
// reports.dto.ts
import {
  IsString, IsNotEmpty, IsOptional, IsEmail,
  IsInt, IsEnum, IsDateString, Length, Min, Max,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateDemoRequestDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  nombre: string

  @IsString()
  @IsNotEmpty()
  @Length(2, 150)
  empresa: string

  @IsEmail()
  correo: string

  @IsString()
  @IsOptional()
  @Length(7, 20)
  telefono?: string

  @IsString()
  @IsOptional()
  @Length(0, 500)
  mensaje?: string
}

// Query params también tienen DTO
export class BalanceSheetQueryDto {
  @IsDateString()
  @IsOptional()
  asOf?: string  // ISO 8601

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20
}
```

### `@Type()` es obligatorio en query params numéricos o booleanos

```typescript
// Sin @Type(), '20' llega como string y @IsInt() falla
export class PaginationDto {
  @IsInt() @Min(1) @Type(() => Number)
  page: number = 1

  @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit: number = 20
}
```

### ValidationPipe global — no reinstanciar

El `ValidationPipe` global ya está configurado en `main.ts` con:
```
whitelist: true           → elimina propiedades no declaradas en el DTO
forbidNonWhitelisted: true → lanza 400 si llegan campos extra
transform: true           → convierte tipos automáticamente (@Type)
```
**No añadir `@UsePipes(ValidationPipe)` a nivel de endpoint.**

---

## 10. Zod — validación de salidas externas

Usar Zod **exclusivamente** para validar datos que vienen de fuera del sistema: respuestas de LLMs, APIs de DIAN, APIs de Wompi, archivos Excel/CSV importados, webhooks recibidos.

**No usar Zod para DTOs HTTP** — eso es responsabilidad de class-validator.

### Patrón: validar respuesta de LLM antes de persistir

```typescript
import { z } from 'zod'

const OcrExtractedSchema = z.object({
  vendor:    z.string().max(200).optional(),
  vendorNit: z.string().max(20).optional(),
  date:      z.string().optional(),
  items: z.array(z.object({
    description: z.string().max(500),
    quantity:    z.number().positive(),
    unitPrice:   z.number().nonnegative(),
    taxRate:     z.number().min(0).max(100),
    subtotal:    z.number().nonnegative(),
  })).optional().default([]),
  subtotal: z.number().nonnegative().optional(),
  taxTotal: z.number().nonnegative().optional(),
  total:    z.number().positive().optional(),
})

// En el service, antes de usar la respuesta del LLM:
const rawJson = await this.extractJsonFromLlmResponse(llmText)
const parsed = OcrExtractedSchema.safeParse(rawJson)

if (!parsed.success) {
  this.logger.warn(`OCR LLM response inválida: ${parsed.error.message}`)
  throw new BadRequestException('No se pudo extraer información del documento. Intenta con una imagen más clara.')
}

const fields = parsed.data  // TypeScript sabe el tipo exacto
```

### Patrón: validar datos de archivo importado fila por fila

```typescript
const ThirdPartyRowSchema = z.object({
  nit:     z.string().min(5).max(20),
  nombre:  z.string().min(2).max(150),
  email:   z.string().email().optional().or(z.literal('')),
  telefono: z.string().max(20).optional(),
  tipo:    z.enum(['client', 'provider', 'employee']),
})

// Por cada fila del Excel:
const result = ThirdPartyRowSchema.safeParse(rowData)
if (!result.success) {
  errors.push({ row: rowIndex, reason: result.error.issues[0].message })
  continue
}
const validRow = result.data  // tipado
```

---

## 11. Prisma — patrones y antipatrones

### findUnique vs. findFirst

```typescript
// findUnique: solo cuando el where usa @id o @unique — más rápido
await this.prisma.subscription.findUnique({ where: { tenantId } })     // @@unique([tenantId])
await this.prisma.product.findUnique({ where: { tenantId_sku: { tenantId, sku } } })  // @@unique

// findFirst: cuando combinas tenantId + id (no garantizados únicos solos en el where)
await this.prisma.invoice.findFirst({ where: { id, tenantId } })
```

### ❌ N+1 — siempre usar `include` o `select` en la misma query

```typescript
// ❌ N+1: una query por factura para obtener el cliente
const invoices = await this.prisma.invoice.findMany({ where: { tenantId } })
for (const inv of invoices) {
  const client = await this.prisma.thirdParty.findUnique({ where: { id: inv.clientId } })
}

// ✅ Una sola query con include
const invoices = await this.prisma.invoice.findMany({
  where: { tenantId },
  include: { client: { select: { id: true, name: true, nit: true } }, items: true },
  orderBy: { issuedAt: 'desc' },
})
```

### select explícito — nunca retornar campos sensibles

```typescript
// ❌ Retorna passwordHash, totpSecret, dianCertificate al cliente
const user = await this.prisma.user.findUnique({ where: { id } })

// ✅ Solo los campos necesarios
const user = await this.prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true, status: true, title: true, createdAt: true },
})
```

### updateMany vs. update

```typescript
// updateMany: silencioso si no encuentra — usar cuando 0 afectados es válido
await this.prisma.subscription.updateMany({
  where: { tenantId },
  data: { invoicesThisMonth: 0 },
})

// update: lanza P2025 si no encuentra — usar cuando la existencia es requerida
await this.prisma.subscription.update({
  where: { tenantId },     // @@unique([tenantId]) existe
  data: { active: false },
})
```

### Errores de Prisma — traducir siempre

```typescript
try {
  await this.prisma.thirdParty.create({ data: { tenantId, nit, ...rest } })
} catch (e: any) {
  if (e.code === 'P2002') {
    const fields = e.meta?.target as string[] | undefined
    if (fields?.includes('nit')) {
      throw new ConflictException(`Ya existe un tercero con NIT ${nit} en esta empresa.`)
    }
    throw new ConflictException('Ya existe un registro con esos datos.')
  }
  if (e.code === 'P2025') throw new NotFoundException('Registro no encontrado.')
  if (e.code === 'P2003') throw new BadRequestException('No se puede eliminar: tiene registros relacionados.')
  throw e  // re-lanzar errores desconocidos para que los capture AllExceptionsFilter
}
```

---

## 12. Paginación

**Obligatoria en todos los endpoints de listado.** Nunca retornar `findMany()` sin `take`.

### DTO estándar de paginación

```typescript
// Extender en cada módulo o importar directamente
export class PaginationDto {
  @IsInt() @Min(1) @Type(() => Number) @IsOptional()
  page: number = 1

  @IsInt() @Min(1) @Max(100) @Type(() => Number) @IsOptional()
  limit: number = 20
}
```

### Implementación estándar en service

```typescript
async findAll(
  tenantId: string,
  { page, limit }: { page: number; limit: number }
): Promise<PaginatedResponse<Invoice>> {
  const skip = (page - 1) * limit

  const [data, total] = await this.prisma.$transaction([
    this.prisma.invoice.findMany({
      where: { tenantId },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { issuedAt: 'desc' },
      skip,
      take: limit,
    }),
    this.prisma.invoice.count({ where: { tenantId } }),
  ])

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}
```

### Límites máximos por tipo de recurso

| Recurso | Límite máximo por página |
|---|---|
| Facturas, Compras, Cotizaciones | 50 |
| Productos, Terceros | 100 |
| Movimientos de inventario | 50 |
| Asientos contables | 50 |
| Registros de uso | 200 |

---

## 13. Transacciones

### Cuándo usar `$transaction`

| Operación | `$transaction` | Razón |
|---|---|---|
| Crear factura + items + stock + ledger | ✅ Sí | Atomicidad de negocio crítica |
| Activar suscripción + crear pago + crear invoice SaaS | ✅ Sí | Webhooks de pago |
| Transferencia de inventario entre bodegas | ✅ Sí | Consistencia de stock |
| Migración o import masivo (>100 filas) | ✅ Sí con timeout | Rollback completo si falla |
| Leer datos para un reporte | ❌ No | Solo lectura |
| Enviar email | ❌ No | Efecto secundario externo, post-TX |
| Crear AuditEvent solo | ❌ No | Tolerante a fallos |
| Webhooks salientes | ❌ No | Efecto secundario externo, post-TX |

### Pasar `tx` como parámetro opcional — patrón del proyecto

```typescript
// En el service que inicia la transacción:
await this.prisma.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ ... })
  await this.ledger.create(tenantId, buildEntry(invoice), tx)  // pasa tx
})

// En ledger.service.ts — acepta tx opcional:
async create(
  tenantId: string,
  data: CreateLedgerEntryData,
  tx?: Prisma.TransactionClient,
): Promise<LedgerEntry> {
  const client = tx ?? this.prisma  // usa tx si viene, prisma directo si no
  return client.ledgerEntry.create({ data: { tenantId, ...data } })
}
```

### Timeouts en transacciones largas

```typescript
// Para imports masivos o migraciones
await this.prisma.$transaction(async (tx) => { ... }, {
  maxWait: 10_000,  // 10s esperando conexión del pool
  timeout: 60_000,  // 60s máximo para la transacción completa
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
})
```

### Efectos secundarios van FUERA de la transacción

```typescript
// ✅ Correcto: email, webhook, audit post-TX (no bloquean el rollback)
const invoice = await this.prisma.$transaction(async (tx) => { ... })

// Post-TX (no críticos para atomicidad del pago)
this.webhookDispatcher.dispatch(tenantId, 'invoice.created', { id: invoice.id })
this.invoiceMailer.sendInvoiceEmail(invoice.id).catch(e =>
  this.logger.warn(`Email no enviado: ${e.message}`)
)

// ❌ Incorrecto: enviar email dentro de $transaction bloquea la conexión
await this.prisma.$transaction(async (tx) => {
  await tx.invoice.create(...)
  await this.mailer.sendEmail(...)  // puede tardar 2-5s, bloquea la TX
})
```

---

## 14. Migrations de schema

### Antes de `npx prisma migrate dev` — checklist completo

```
✅ Columna nueva en tabla con datos: tiene @default() o es nullable (String?)
✅ Relación nueva: onDelete correcto elegido (ver tabla abajo)
✅ Índice añadido para columnas de filtro frecuente (tenantId, status, dates)
✅ Campos sensibles: String? nullable, sin @default, sin aparecer en selects generales
✅ Nombre de migration descriptivo: "add_ocr_run_purchase_relation" no "migration_001"
✅ Ninguna columna existente renombrada directamente (usar deprecated → nuevo campo → backfill → drop)
```

### Reglas de `onDelete`

| Relación | `onDelete` | Motivo |
|---|---|---|
| `InvoiceItem → Invoice` | `Cascade` | El ítem no existe sin la factura |
| `LedgerLine → LedgerEntry` | `Cascade` | La línea no existe sin el asiento |
| `Invoice → ThirdParty (client)` | `SetNull` | La factura sigue existiendo sin el cliente |
| `InventoryMovement → Product` | `Restrict` | No eliminar producto con movimientos |
| `Purchase → Tenant` | `Cascade` | Si se elimina el tenant, todo su historial |
| `OcrRun → Purchase` | `SetNull` | El OCR puede existir sin compra asociada |

### Índices obligatorios por patrón de query

```prisma
// Toda tabla con tenantId que se filtre frecuentemente:
@@index([tenantId])
@@index([tenantId, status])     // cuando se filtra por status además
@@index([tenantId, createdAt])  // cuando se ordena por fecha
@@index([tenantId, issuedAt])   // para facturas/compras

// Para búsquedas de unicidad del negocio:
@@unique([tenantId, nit])       // ThirdParty
@@unique([tenantId, sku])       // Product
@@unique([tenantId])            // Subscription (1 por tenant)
```

---

## 15. Cuotas y límites de plan

### Fuente única de verdad: `plans.config.ts`

```typescript
// plans.config.ts — ya existe, nunca duplicar en otro lugar
export const PLANS = {
  starter:    { maxInvoicesPerMonth: 50,   maxUsers: 1,    maxAiQueriesPerMonth: 100,  maxOcrRunsPerMonth: 10  },
  pyme:       { maxInvoicesPerMonth: null, maxUsers: 5,    maxAiQueriesPerMonth: 500,  maxOcrRunsPerMonth: 50  },
  enterprise: { maxInvoicesPerMonth: null, maxUsers: null, maxAiQueriesPerMonth: null, maxOcrRunsPerMonth: null },
}
```

### Usar `UsageService.checkLimit()` — nunca reimplementar

```typescript
// ✅ Correcto — delegar siempre
const check = await this.usageService.checkLimit(tenantId, 'invoice_created')
if (!check.allowed) {
  throw new ForbiddenException(
    `Límite mensual de facturas alcanzado (${check.current}/${check.limit}). ` +
    `Actualiza tu plan en Configuración → Suscripción.`
  )
}

// ❌ Nunca implementar la lógica de cuota directamente en el service
const sub = await this.prisma.subscription.findUnique(...)
if (sub.invoicesThisMonth >= 50) { ... }  // hardcodear 50 es un error
```

### Features y nombres canónicos de `UsageRecord`

| Feature string | Qué mide | Límite en plan |
|---|---|---|
| `invoice_created` | Facturas electrónicas ERP emitidas | `maxInvoicesPerMonth` |
| `ai_query` | Consultas a ContexAI (chat + advisor) | `maxAiQueriesPerMonth` |
| `ocr_run` | Documentos procesados por OCR | `maxOcrRunsPerMonth` |
| `email_sent` | Emails transaccionales enviados | `maxEmailsPerMonth` |
| `user_active` | Usuarios activos en el mes | `maxUsers` |

### Registrar uso: después de la operación exitosa, dentro de TX cuando sea atómico

```typescript
// Dentro de $transaction (atómico con la creación):
await this.usageService.recordUsage(tenantId, 'invoice_created')  // en invoices.service.ts

// Fuera de $transaction (tolerante a fallos):
try {
  await this.usageService.recordUsage(tenantId, 'ocr_run')
} catch (e: any) {
  this.logger.warn(`No se pudo registrar uso ocr_run para ${tenantId}: ${e.message}`)
  // NO relanzar — el OCR ya fue procesado, el tracking es secundario
}
```

---

## 16. Ledger contable — asientos automáticos

**Regla:** Todo movimiento de dinero genera un asiento contable de doble partida. Para plan Pyme y Enterprise esta regla es invariable. Para plan Starter, se registra al menos el asiento de ingreso.

### Cuentas PUC Colombia — usar siempre estas

| Código | Cuenta | Uso |
|---|---|---|
| `110505` | Caja general | Débito/Crédito en pagos en efectivo |
| `111005` | Banco corriente | Débito/Crédito en transferencias |
| `130505` | Clientes nacionales (CxC) | Débito al emitir factura |
| `143505` | Inventario de mercancías | Débito al recibir compra |
| `220505` | Proveedores nacionales (CxP) | Crédito al registrar compra |
| `240805` | IVA generado (pasivo) | Crédito en IVA de ventas |
| `251005` | IVA descontable (activo) | Débito en IVA de compras |
| `413595` | Ingresos operacionales | Crédito al facturar |
| `510506` | Costo de ventas | Débito al vender producto con costo |

### Asiento factura de venta

```typescript
await this.ledger.create(tenantId, {
  referenceType: 'invoice',
  referenceId: invoice.id,
  description: `Factura ${invoice.number} — ${clientName}`,
  amount: total,
  lines: [
    { account: '130505', label: 'Clientes nacionales',    debit: total,    credit: 0       },
    { account: '413595', label: 'Ingresos operacionales', debit: 0,        credit: subtotal },
    { account: '240805', label: 'IVA generado',           debit: 0,        credit: taxTotal },
  ],
}, tx)
```

### Verificar cuadre antes de persistir — obligatorio

```typescript
function assertLedgerBalanced(lines: LedgerLineInput[]) {
  const totalDebit  = lines.reduce((s, l) => s + Number(l.debit),  0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new BadRequestException(
      `Asiento contable desbalanceado: débito ${totalDebit} ≠ crédito ${totalCredit}`
    )
  }
}
```

---

## 17. AuditEvent — trazabilidad

### Cuándo crear AuditEvent — tabla de decisión

| Operación | Severidad | Obligatorio |
|---|---|---|
| Sesión iniciada / cerrada | `info` | ✅ |
| Factura emitida / cancelada | `info` | ✅ |
| Pago aprobado / rechazado | `info` / `warning` | ✅ |
| Suscripción activada / cancelada | `info` / `warning` | ✅ |
| Usuario añadido / eliminado | `warning` | ✅ |
| Cambio de rol | `warning` | ✅ |
| Configuración DIAN modificada | `warning` | ✅ |
| Exportación de datos | `info` | ✅ (GDPR/Ley 1581) |
| Eliminación de cuenta/empresa | `warning` | ✅ |
| Import masivo ejecutado | `info` | ✅ |
| Conciliación bancaria | `info` | ✅ |
| Acceso denegado sospechoso | `warning` | ✅ |
| Error de integración DIAN | `error` | ✅ |
| Brecha de seguridad detectada | `critical` | ✅ |

### Patrón estándar — método helper en el service

```typescript
// En el service, crear método privado para no repetir boilerplate:
private async createAudit(
  tenantId: string,
  actorUserId: string | null,
  entity: string,
  action: string,
  description: string,
  severity: 'info' | 'warning' | 'error' | 'critical' = 'info',
) {
  // Tolerante a fallos — el audit no debe romper el flujo principal
  this.prisma.auditEvent.create({
    data: {
      tenantId,
      entity,
      action,
      description,
      actor: actorUserId ?? 'Sistema',
      actorUserId,
      severity,
    },
  }).catch(e => this.logger.warn(`AuditEvent no registrado: ${e.message}`))
}
```

---

## 18. Manejo de errores

### Excepciones HTTP — mapa semántico

```typescript
NotFoundException           // 404 — registro no encontrado con tenantId correcto
BadRequestException         // 400 — datos inválidos, regla de negocio violada
ForbiddenException          // 403 — sin permiso, cuota excedida, plan insuficiente
UnauthorizedException       // 401 — sin JWT válido (solo en guards)
ConflictException           // 409 — unicidad violada (NIT, SKU, email duplicado)
UnprocessableEntityException // 422 — datos válidos pero semánticamente inconsistentes
ServiceUnavailableException  // 503 — servicio externo (DIAN, Wompi) no disponible
```

### Mensajes de error — en español, orientados al usuario final

```typescript
// ✅ Mensaje accionable para el usuario
throw new ForbiddenException(
  'Has alcanzado el límite de 50 facturas/mes del plan Starter. ' +
  'Actualiza tu plan en Configuración → Suscripción para continuar facturando.'
)

// ❌ Mensaje técnico que no ayuda al usuario
throw new ForbiddenException('QUOTA_EXCEEDED')
throw new BadRequestException('P2002: Unique constraint failed on field nit')
```

### AllExceptionsFilter — ya captura todo

El `AllExceptionsFilter` global (registrado en `main.ts`) captura:
- `HttpException` → retorna su `statusCode` y `message`
- Errores de Prisma (código `P\d+`) → traduce al mensaje en `PRISMA_ERROR_MESSAGES`
- `Error` genérico → 500, oculta stack en producción

**No reinventar este filtro en módulos individuales.**

### ❌ Nunca silenciar errores en paths críticos

```typescript
// ❌ El usuario no sabe que la factura DIAN no se emitió
try {
  await this.dianService.sendInvoice(payload)
} catch (e) {}  // silencio peligroso

// ✅ Loggear + re-lanzar o notificar con contexto
try {
  await this.dianService.sendInvoice(payload)
} catch (e: any) {
  this.logger.error(`DIAN error en factura ${invoiceId}: ${e.message}`, e.stack)
  throw new ServiceUnavailableException(
    `Error al enviar la factura a la DIAN: ${e.message}. Intenta nuevamente.`
  )
}
```

---

## 19. Logging con Pino

### Declaración en cada clase — nunca importar un logger global

```typescript
private readonly logger = new Logger(NombreService.name)
// El nombre aparece en el log: [NombreService] Factura FV-000042 emitida
```

### Niveles y cuándo usarlos

```typescript
this.logger.log(...)    // info: operaciones normales del ciclo de vida del negocio
this.logger.warn(...)   // warn: eventos sospechosos, recuperables, cuotas rozadas
this.logger.error(...)  // error: excepciones con stack trace, pérdida de operación
this.logger.debug(...)  // debug: solo desarrollo — desactivado con LOG_LEVEL=info
```

### ✅ Qué loggear

```typescript
// Operaciones de negocio exitosas
this.logger.log(`Factura ${invoice.number} emitida para tenant ${tenantId}`)
this.logger.log(`OCR completado para ${ocrRunId}: ${confidence}% confianza`)
this.logger.log(`Suscripción ${planType} activada para tenant ${tenantId}`)

// Eventos de advertencia
this.logger.warn(`Tenant ${tenantId} rozando cuota: ${current}/${limit} facturas`)
this.logger.warn(`Webhook a ${hookUrl} falló (intento ${attempt}/5): ${e.message}`)

// Errores con contexto
this.logger.error(`Error DIAN para factura ${id}: ${e.message}`, e.stack)
this.logger.error(`Wompi webhook inválido desde IP ${ip}: ${e.message}`)
```

### ❌ Nunca loggear estos datos

```typescript
// Credenciales y secretos
this.logger.log(`Password: ${user.passwordHash}`)
this.logger.log(`Token JWT: ${token}`)
this.logger.log(`DIAN cert: ${tenant.dianCertificate}`)
this.logger.log(`SMTP pass: ${tenant.smtpPassword}`)

// Datos personales completos
this.logger.log(`NIT completo: ${tenant.nit}`)
this.logger.log(`Cuerpo completo de request: ${JSON.stringify(body)}`)

// Stack traces de errores Prisma con queries
// (AllExceptionsFilter los recorta antes de responder)
```

---

## 20. Colas y background jobs

### Cuándo usar cola en lugar de procesamiento síncrono

| Operación | Síncrona | Cola | Razón |
|---|---|---|---|
| Crear factura en BD | ✅ | ❌ | Necesita respuesta inmediata |
| Emitir factura ante DIAN | ❌ | ✅ | Tarda 3-10s, puede fallar por DIAN |
| Procesar OCR de documento | ❌ | ✅ | Tarda 5-30s según tamaño |
| Enviar email | ❌ | ✅ | Efecto secundario, no crítico |
| Generar PDF de factura | ❌ | ✅ | CPU-intensivo |
| Disparar webhooks salientes | ❌ | ✅ | Efecto externo, puede fallar |
| Importar 1.000 filas de Excel | ❌ | ✅ | Bloquearía el request por 30s+ |

### Estructura de un processor Bull (cuando se implemente)

```typescript
// dian.processor.ts
import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { Logger } from '@nestjs/common'

interface DianEmitJob {
  invoiceId: string
  tenantId: string
  retryCount?: number
}

@Processor('dian-invoice')
export class DianInvoiceProcessor {
  private readonly logger = new Logger(DianInvoiceProcessor.name)

  constructor(
    private readonly dianService: DianService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('emit')
  async processEmission(job: Job<DianEmitJob>) {
    const { invoiceId, tenantId } = job.data
    this.logger.log(`Procesando emisión DIAN: factura ${invoiceId} (intento ${job.attemptsMade + 1})`)

    try {
      const result = await this.dianService.sendInvoice({ invoiceId, tenantId })

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'emitted', timeline: { push: { type: 'dian', status: result.status, at: new Date() } } },
      })

      this.logger.log(`Factura ${invoiceId} emitida ante DIAN: ${result.cufe}`)
    } catch (e: any) {
      this.logger.error(`Error DIAN factura ${invoiceId}: ${e.message}`)

      // Actualizar estado en BD para que el frontend muestre el error
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { timeline: { push: { type: 'dian_error', message: e.message, at: new Date() } } },
      })

      throw e  // re-lanzar para que Bull reintente
    }
  }
}

// Configuración de cola al encolar:
await this.dianQueue.add('emit', { invoiceId, tenantId }, {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },  // 2s, 4s, 8s, 16s, 32s
  removeOnComplete: 100,
  removeOnFail: 500,
})
```

### Hasta que Bull esté implementado — operación asíncrona no bloqueante

```typescript
// Mientras no haya cola, usar fire-and-forget con manejo de error:
this.dianService.sendInvoice({ invoiceId, tenantId }).then(async (result) => {
  await this.prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'emitted' },
  })
}).catch(async (e) => {
  this.logger.error(`Emisión DIAN fallida para ${invoiceId}: ${e.message}`)
  await this.prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'draft' },  // revertir para reintento manual
  })
})
// El endpoint HTTP ya retornó 201 — no bloquea al usuario
```

---

## 21. Crons y schedulers

### Separar scheduler del service — siempre

```typescript
// subscriptions.scheduler.ts — solo orquesta, nunca lógica
@Injectable()
export class SubscriptionsScheduler {
  private readonly logger = new Logger(SubscriptionsScheduler.name)

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Cron('0 0 1 * *', { name: 'reset-monthly-invoice-counters' })
  async resetMonthlyCounters() {
    this.logger.log('Iniciando reset mensual de contadores de facturas')
    try {
      const count = await this.subscriptionsService.resetMonthlyInvoiceCounters()
      this.logger.log(`Reset mensual completado: ${count} suscripciones actualizadas`)
    } catch (e: any) {
      this.logger.error(`Error en reset mensual: ${e.message}`, e.stack)
      // NO relanzar — el cron no debe crashear el proceso
    }
  }
}
```

### Reglas de crons — sin excepciones

```
✅ Nunca lanzar excepción no capturada — capturar siempre con try/catch
✅ Ser idempotente — ejecutar N veces = mismo resultado que 1 vez
✅ Procesar en lotes con cursor (no cargar todos los registros en memoria)
✅ Loggear: inicio con contexto, fin con cantidad procesada, errores con stack
✅ Registrar en AuditEvent si el cron muta datos de negocio críticos
✅ Nombrar el cron con { name: 'nombre-descriptivo' } para identificar en logs
```

### Crons canónicos del proyecto

| Nombre | Expresión | Propósito |
|---|---|---|
| `reset-monthly-invoice-counters` | `0 0 1 * *` | Primero de mes, medianoche |
| `churn-detection` | `0 10 * * *` | Diario, 10 AM |
| `dian-folio-alert` | `0 9 * * *` | Diario, 9 AM |
| `trial-expiry-check` | `0 10 * * *` | Diario, 10 AM |
| `dunning-emails` | `0 8 * * 1` | Lunes, 8 AM |
| `monthly-insights-cache` | `0 8 1 * *` | Primero de mes, 8 AM |

### Procesamiento en lotes para crons sobre muchos tenants

```typescript
async resetMonthlyInvoiceCounters(): Promise<number> {
  let total = 0
  let cursor: string | undefined

  do {
    const batch = await this.prisma.subscription.findMany({
      where: { active: true },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: { id: true },
    })

    if (batch.length === 0) break

    await this.prisma.subscription.updateMany({
      where: { id: { in: batch.map(s => s.id) } },
      data: { invoicesThisMonth: 0 },
    })

    total += batch.length
    cursor = batch[batch.length - 1].id
  } while (true)

  return total
}
```

---

## 22. Event-driven dentro del proceso

Usar `EventEmitter2` de `@nestjs/event-emitter` para comunicación desacoplada entre módulos del mismo proceso.

### Cuándo usar eventos internos

- Cuando el módulo A necesita notificar al módulo B sin conocerlo directamente
- Cuando múltiples módulos reaccionan al mismo evento (invoice.emitted → ledger, dian, email, webhook)
- Para evitar imports circulares

```typescript
// En invoices.service.ts — emitir evento
import { EventEmitter2 } from '@nestjs/event-emitter'

constructor(private readonly eventEmitter: EventEmitter2) {}

// Después de crear la factura exitosamente:
this.eventEmitter.emit('invoice.created', {
  invoiceId: invoice.id,
  tenantId,
  number: invoice.number,
  total: invoice.total,
})

// En dian.listener.ts — escuchar
import { OnEvent } from '@nestjs/event-emitter'

@OnEvent('invoice.created')
async handleInvoiceCreated(payload: InvoiceCreatedEvent) {
  await this.dianQueue.add('emit', { invoiceId: payload.invoiceId, tenantId: payload.tenantId })
}
```

---

## 23. IA — ContexAI

### Reglas de seguridad de datos — no negociables

```typescript
// Antes de enviar datos al LLM, anonimizar SIEMPRE
private sanitizeForLlm(data: TenantFinancialContext): SanitizedContext {
  return {
    ...data,
    // Eliminar datos identificables antes del prompt
    thirdParties: data.thirdParties.map((t, i) => ({
      id: `ENTITY_${i + 1}`,  // no el ID real de BD
      name: `Cliente_${i + 1}`,
      nit: 'REDACTED',
      email: 'REDACTED',
      type: t.type,  // conservar tipo: cliente/proveedor
    })),
    tenant: {
      ...data.tenant,
      nit: 'REDACTED',
      address: 'REDACTED',
      phone: 'REDACTED',
      smtpPassword: undefined,
      dianCertificate: undefined,
    },
  }
}
```

### Validar salida del LLM con Zod antes de persistir

```typescript
// Nunca confiar en el JSON del LLM sin validar
const rawText = await this.gemini.generateContent(prompt)
const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/) || rawText.match(/\{[\s\S]*\}/)
const rawJson = JSON.parse(jsonMatch?.[1] || rawText)

const validation = MyOutputSchema.safeParse(rawJson)
if (!validation.success) {
  this.logger.warn(`LLM output inválido: ${validation.error.message}`)
  throw new BadRequestException('El asistente de IA no pudo generar una respuesta válida. Intenta con una consulta más específica.')
}
const safeData = validation.data  // TypeScript conoce el tipo exacto
```

### Rate limiting de IA — doble capa

```typescript
// 1. Throttle HTTP (global en controller)
@Throttle({ short: { ttl: 60000, limit: 10 } })
@Post('chat')
async chat(...) {}

// 2. Verificar cuota de plan (en service)
const check = await this.usageService.checkLimit(tenantId, 'ai_query')
if (!check.allowed) {
  throw new ForbiddenException(
    `Límite de ${check.limit} consultas de IA por mes alcanzado. Actualiza tu plan.`
  )
}

// 3. Registrar uso DESPUÉS de respuesta exitosa del LLM
await this.usageService.recordUsage(tenantId, 'ai_query')
```

### Prompts — estructura estándar del proyecto

```typescript
// Siempre incluir: instrucción clara, formato de salida, manejo de errores
const prompt = `
Eres ContexAI, el asistente financiero de Contex360 ERP para empresas colombianas.
Responde SOLO en español. Sé conciso y práctico.

CONTEXTO FINANCIERO (datos anonimizados):
${JSON.stringify(sanitizedContext, null, 2)}

PREGUNTA DEL USUARIO:
${userMessage}

INSTRUCCIONES:
- Si la pregunta no está relacionada con contabilidad, finanzas o negocios, indica que no puedes ayudar con ese tema.
- Si los datos no son suficientes para responder con precisión, dilo claramente.
- Responde en formato markdown si incluyes listas o tablas.
- Nunca inventes cifras que no estén en los datos proporcionados.
`
```

---

## 24. OCR y procesamiento de archivos

### Validar MIME type en el backend — nunca confiar en Content-Type del cliente

```typescript
import * as fileType from 'file-type'

@Post('ocr-upload')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 10 * 1024 * 1024 },  // 10MB máximo
}))
async ocrUpload(
  @TenantId() tenantId: string,
  @UploadedFile() file: Express.Multer.File,
) {
  if (!file) throw new BadRequestException('Archivo requerido')
  
  // Validar MIME real del buffer (no el header)
  const detected = await fileType.fromBuffer(file.buffer)
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  
  if (!detected || !allowed.includes(detected.mime)) {
    throw new BadRequestException(
      `Tipo de archivo no permitido: ${detected?.mime ?? 'desconocido'}. ` +
      `Usa PDF, JPG, PNG o WebP.`
    )
  }

  return this.aiService.processOcr(tenantId, file.buffer, detected.mime)
}
```

### Flujo completo de OCR — orden de operaciones

```
1. Validar autenticación + plan (pyme o enterprise)
2. Verificar cuota: usageService.checkLimit(tenantId, 'ocr_run')
3. Validar MIME real del buffer
4. Upload a R2/S3 → obtener URL permanente
5. CREATE OcrRun { tenantId, status: 'processing', source: url }
6. Llamar a Gemini Vision con el archivo
7. Validar respuesta con Zod (OcrExtractedSchema)
8. UPDATE OcrRun { fields: parsedData, confidence, status: 'processed' }
9. Si autoCreatePurchase: CREATE Purchase draft con los datos
10. recordUsage(tenantId, 'ocr_run')
11. Retornar { ocrRunId, fields, confidence, purchaseId? }
```

### Nunca procesar OCR síncronamente si el archivo es > 2MB

```typescript
// Archivo grande → encolar en segundo plano
if (file.size > 2 * 1024 * 1024) {
  const ocrRun = await this.prisma.ocrRun.create({
    data: { tenantId, status: 'queued', source: fileUrl, fields: {}, confidence: 0 },
  })
  await this.ocrQueue.add('process', { ocrRunId: ocrRun.id, tenantId, fileUrl })
  return { ocrRunId: ocrRun.id, status: 'queued', message: 'Procesando en segundo plano...' }
}

// Archivo pequeño → procesar síncronamente
return this.processOcrSync(tenantId, file.buffer, fileUrl)
```

---

## 25. Uploads — archivos en S3/R2

### Nunca almacenar archivos en disco del contenedor

Los contenedores en Railway/Hugging Face son efímeros. Todo archivo debe ir a Cloudflare R2 o AWS S3.

### Estructura del servicio de storage

```typescript
// src/common/storage/r2-storage.service.ts
@Injectable()
export class R2StorageService {
  private readonly s3: S3Client
  private readonly bucket: string
  private readonly publicUrl: string

  constructor(private readonly config: ConfigService) {
    this.bucket = config.getOrThrow('R2_BUCKET')
    this.publicUrl = config.getOrThrow('R2_PUBLIC_URL')
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: config.getOrThrow('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.getOrThrow('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      },
    })
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }))
    return `${this.publicUrl}/${key}`
  }

  buildKey(tenantId: string, folder: string, filename: string): string {
    // Estructura: tenants/<tenantId>/ocr/2026-05/archivo.pdf
    const month = new Date().toISOString().slice(0, 7)
    return `tenants/${tenantId}/${folder}/${month}/${filename}`
  }
}
```

### Nombre de archivo — nunca usar el nombre original del cliente

```typescript
// ❌ Peligroso: path traversal, caracteres inválidos
const key = `uploads/${file.originalname}`

// ✅ UUID + extensión validada
import { randomUUID } from 'crypto'
const ext = detected.ext  // de file-type, no del nombre original
const key = this.r2.buildKey(tenantId, 'ocr', `${randomUUID()}.${ext}`)
```

---

## 26. Billing — Wompi y suscripciones

### Webhook de Wompi — reglas de seguridad no negociables

```typescript
// 1. SIEMPRE verificar la firma antes de procesar
const valid = this.wompiService.verifyWebhook(signature, body)
if (!valid) {
  this.logger.warn(`Firma de webhook Wompi inválida — posible ataque`)
  throw new BadRequestException('Invalid webhook signature')
}

// 2. SIEMPRE verificar idempotencia antes de activar la suscripción
const existing = await tx.payment.findUnique({
  where: { wompiTransactionId: transactionId },
})
if (existing) {
  this.logger.log(`Transacción ${transactionId} ya procesada — saltando`)
  return { received: true }
}

// 3. SIEMPRE usar $transaction para activar suscripción + crear pago
await this.prisma.$transaction(async (tx) => {
  // activar suscripción, crear Payment, crear SubscriptionInvoice
  // todo en un bloque atómico
})

// 4. Post-transacción: emails, DIAN (no críticos para atomicidad del pago)
```

### SKU de Wompi — formato canónico

```typescript
// Formato: planType_billing_tenantId
// Ejemplo: pyme_annual_clx1234567890
const sku = `${planType}_${billing}_${tenantId}`

// Al parsear en el webhook:
const [planType, billing, tenantId] = sku.split('_')
if (!planType || !billing || !tenantId) {
  this.logger.warn(`SKU inválido: ${sku}`)
  return { received: true }  // no lanzar excepción — Wompi reintentaría
}
```

### Manejo de pagos fallidos — siempre notificar, nunca silenciar

```typescript
if (['DECLINED', 'VOIDED', 'ERROR', 'EXPIRED'].includes(transactionStatus)) {
  await this.handleFailedPayment(body, transactionId, sku, transactionStatus)
  return { received: true }
}

private async handleFailedPayment(...) {
  // 1. AuditEvent con severity 'warning'
  // 2. Email al admin del tenant
  // 3. Si 3+ fallos consecutivos → poner subscription en 'past_due'
}
```

### Estado de suscripción — máquina de estados

```
trialing → active         (primer pago aprobado)
active   → past_due      (pago rechazado / fallido)
active   → canceled      (usuario cancela)
past_due → active        (pago reintentado exitoso)
past_due → canceled      (sin pago tras grace period)
canceled → active        (reactivación con nuevo pago)
```

---

## 27. DIAN — facturación electrónica

### Reglas de seguridad críticas

```typescript
// 1. Certificados: NUNCA en disco, SIEMPRE en Base64 en variable de entorno
const certBase64 = this.config.getOrThrow('DIAN_CERTIFICATE')
const certBuffer = Buffer.from(certBase64, 'base64')
// Usar certBuffer en memoria para firmar el XML
// certBuffer = null después de usarlo si es posible

// 2. NUNCA loggear el certificado, ni el PIN del software, ni el NIT del software
this.logger.log(`Emitiendo factura ${number} para ${tenantId}`)  // OK
this.logger.log(`Usando certificado: ${cert}`)  // ❌ NUNCA

// 3. Validar que el tenant está habilitado en DIAN antes de emitir
if (!tenant.dianCertificate || !tenant.invoiceResolution) {
  throw new BadRequestException(
    'La empresa no está configurada para facturación electrónica. ' +
    'Completa la configuración DIAN en Configuración → DIAN.'
  )
}

// 4. Verificar vigencia de la resolución
if (tenant.resolutionTo && tenant.resolutionTo < new Date()) {
  throw new BadRequestException(
    'La resolución de facturación electrónica ha expirado. ' +
    'Renueva tu resolución ante la DIAN.'
  )
}
```

### Estructura de respuesta DIAN — siempre registrar en timeline

```typescript
const timeline = [
  ...(invoice.timeline as any[] || []),
  {
    type: 'dian',
    action: 'emit',
    at: new Date().toISOString(),
    status: dianResponse.status,     // 'accepted' | 'rejected' | 'pending'
    message: dianResponse.message,
    cufe: dianResponse.cufe,
    trackId: dianResponse.dianTrackingId,
    xmlFileName: dianResponse.xmlFileName,
  },
]

await this.prisma.invoice.update({
  where: { id: invoiceId },
  data: { timeline, cufe: dianResponse.cufe, status: 'emitted' },
})
```

### Ambiente test vs. producción — nunca mezclar

```typescript
const dianEnv = tenant.dianEnvironment  // 'test' | 'production'
if (dianEnv === 'production' && process.env.NODE_ENV !== 'production') {
  this.logger.warn(`Tenant ${tenantId} usa ambiente DIAN producción en entorno no-producción`)
}
```

---

## 28. Webhooks salientes

### Estructura del dispatcher

```typescript
// webhooks/webhook-dispatcher.service.ts
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name)

  async dispatch(tenantId: string, event: string, payload: object): Promise<void> {
    const hooks = await this.prisma.webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
    })

    // Fire-and-forget: webhooks no bloquean el request principal
    hooks.forEach(hook => {
      this.deliver(hook, event, payload).catch(e =>
        this.logger.warn(`Webhook ${hook.id} a ${hook.url} falló: ${e.message}`)
      )
    })
  }

  private async deliver(hook: Webhook, event: string, payload: object): Promise<void> {
    const body = JSON.stringify({
      event,
      data: payload,
      timestamp: new Date().toISOString(),
      tenantId: hook.tenantId,
    })

    // Firma HMAC-SHA256 del payload
    const sig = createHmac('sha256', hook.secret ?? 'no-secret')
      .update(body)
      .digest('hex')

    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Contex360-Signature': `sha256=${sig}`,
          'X-Contex360-Event': event,
          'X-Contex360-Delivery': randomUUID(),
        },
        body,
        signal: AbortSignal.timeout(10_000),  // 10s timeout
      })

      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          lastSent: new Date(),
          lastStatus: String(response.status),
          retryCount: response.ok ? 0 : { increment: 1 },
        },
      })

      if (!response.ok) {
        // Deshabilitar si acumula 10 fallos consecutivos
        if (hook.retryCount >= 9) {
          await this.prisma.webhook.update({
            where: { id: hook.id },
            data: { active: false },
          })
          this.logger.warn(`Webhook ${hook.id} deshabilitado por 10 fallos consecutivos`)
        }
      }
    } catch (e: any) {
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: { lastStatus: 'timeout', retryCount: { increment: 1 } },
      })
      throw e
    }
  }
}
```

### Eventos canónicos del sistema

| Evento | Trigger |
|---|---|
| `invoice.created` | Factura creada (draft o emitted) |
| `invoice.emitted` | Factura aceptada por DIAN |
| `invoice.cancelled` | Factura anulada |
| `payment.approved` | Pago de suscripción aprobado |
| `subscription.activated` | Suscripción activada o renovada |
| `subscription.cancelled` | Suscripción cancelada |
| `stock.low` | Stock de producto < minStock |
| `ocr.completed` | OCR procesado con campos extraídos |

---

## 29. Observabilidad y métricas

### Qué métricas registrar en `UsageRecord`

```typescript
// En cada feature de negocio, registrar:
await this.usageService.recordUsage(tenantId, 'invoice_created')
await this.usageService.recordUsage(tenantId, 'ai_query')
await this.usageService.recordUsage(tenantId, 'ocr_run')
await this.usageService.recordUsage(tenantId, 'email_sent')
```

### Health check — ya existe en `health.module.ts`

```
GET /api/v1/health  → { status: 'ok' | 'error', db: string, timestamp: string }
```

Añadir checks adicionales si se agregan dependencias externas (Redis, R2, Gemini).

### Trazabilidad de requests — Correlation ID

Cada request HTTP tiene un `X-Correlation-Id` generado por el `LoggingInterceptor`. Incluir este ID en logs de operaciones largas para correlacionar llamadas:

```typescript
// En el LoggingInterceptor ya existente — el correlationId está en el contexto
// Al encolar un job, pasar el correlationId para trazar end-to-end:
await this.dianQueue.add('emit', {
  invoiceId,
  tenantId,
  correlationId: request.headers['x-correlation-id'],
})
```

---

## 30. Testing — contrato mínimo

Todo service nuevo requiere **mínimo 4 tests** antes de hacer merge:

```typescript
// <nombre>.service.spec.ts
import { Test } from '@nestjs/testing'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

describe('ReportsService', () => {
  let service: ReportsService
  let prisma: DeepMockProxy<PrismaService>
  let usageService: DeepMockProxy<UsageService>

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>()
    usageService = mockDeep<UsageService>()

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageService, useValue: usageService },
      ],
    }).compile()

    service = module.get(ReportsService)
  })

  // TEST 1: Happy path — la operación principal funciona
  it('retorna balance sheet con datos correctos', async () => {
    prisma.ledgerLine.groupBy.mockResolvedValue([
      { account: '130505', _sum: { debit: 5_000_000, credit: 0 } },
      { account: '413595', _sum: { debit: 0, credit: 4_201_681 } },
    ])
    const result = await service.getBalanceSheet('tenant-1', new Date())
    expect(result.assets['130505']).toBe(5_000_000)
    expect(result.balanced).toBe(false)  // solo activos en este caso
  })

  // TEST 2: Aislamiento multi-tenant — el tenantId se propaga a la query
  it('filtra por tenantId en todas las queries', async () => {
    await service.getBalanceSheet('tenant-abc', new Date())
    expect(prisma.ledgerLine.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ledgerEntry: expect.objectContaining({ tenantId: 'tenant-abc' }),
        }),
      })
    )
  })

  // TEST 3: Error handling — lanza la excepción correcta
  it('lanza NotFoundException si el tenant no existe', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null)
    await expect(service.create('tenant-bad', 'user-1', dto))
      .rejects.toThrow(NotFoundException)
  })

  // TEST 4: Quota enforcement — bloquea si el límite está alcanzado
  it('lanza ForbiddenException si la cuota está agotada', async () => {
    usageService.checkLimit.mockResolvedValue({ allowed: false, current: 50, limit: 50 })
    await expect(service.create('tenant-1', 'user-1', dto))
      .rejects.toThrow(ForbiddenException)
  })
})
```

### Tests de integración para endpoints críticos de billing

Los webhooks de Wompi y el checkout requieren tests de integración E2E que verifiquen:
- Idempotencia: el mismo `wompiTransactionId` procesado dos veces no crea dos pagos
- Verificación de firma: webhook con firma inválida retorna 400
- Activación de suscripción: el tenant queda con `active: true` tras webhook exitoso

---

## 31. Variables de entorno

### Nunca `process.env.X` en servicios — usar `ConfigService`

```typescript
// ❌ Acceso directo: no valida en startup, tipado perdido
const key = process.env.GEMINI_API_KEY

// ✅ ConfigService: valida en startup con getOrThrow, tipado con genérico
constructor(private readonly config: ConfigService) {}
const key = this.config.getOrThrow<string>('GEMINI_API_KEY')
```

### Variables nuevas — añadir al validador de startup

```typescript
// src/common/env-validator.ts — REQUIRED_ENV_VARS
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'CORS_ORIGIN',
  // Añadir aquí toda variable nueva obligatoria
]
```

### Inventario de variables por dominio

```bash
# Core (obligatorias — ya definidas)
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
CORS_ORIGIN=
ENCRYPTION_KEY=           # 32 bytes hex para cifrado AES

# Wompi / Billing
WOMPI_PRIVATE_KEY=
WOMPI_PUBLIC_KEY=
WOMPI_EVENTS_PROPERTIES_SIGNATURE=

# DIAN — tenant del SaaS mismo (para facturar suscripciones)
SAAS_DIAN_NIT=
SAAS_DIAN_SOFTWARE_ID=
SAAS_DIAN_SOFTWARE_PIN=
SAAS_DIAN_CERTIFICATE=        # Base64 del .pfx
SAAS_DIAN_CERTIFICATE_PASSWORD=
SAAS_DIAN_ENVIRONMENT=test    # test | production
SAAS_DIAN_RESOLUTION=
SAAS_DIAN_PREFIX=
SAAS_COMPANY_NAME=Contex360 SAS

# IA
GEMINI_API_KEY=
GROQ_API_KEY=

# Storage (Cloudflare R2 o AWS S3)
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=

# Redis (para rate limiting distribuido — P2)
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

# Email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# App
FRONTEND_URL=
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
```

---

## 32. Checklist pre-commit

Verificar **todos** los puntos antes de abrir PR. Un fallo en cualquiera bloquea el merge.

### 🔴 SEGURIDAD — Fallo = bloqueo inmediato

```
✅ Ningún query de negocio omite tenantId en el where
✅ Ningún $queryRawUnsafe con concatenación de strings
✅ Ningún endpoint público retorna IDs internos, tenantIds ni configuraciones
✅ Ningún log contiene: passwords, tokens JWT, NITs, certificados, smtpPassword
✅ Ninguna variable de entorno hardcodeada (ni siquiera en tests)
✅ Archivos recibidos: MIME validado con file-type, no con Content-Type del cliente
✅ Webhooks entrantes (Wompi): firma verificada antes de procesar
✅ Datos enviados a LLM: anonimizados (sin NITs, nombres reales, emails)
```

### 🟠 DATOS — Fallo = bug de producción

```
✅ DTOs: toda propiedad tiene al menos un decorador de validación
✅ Salidas de LLMs y APIs externas: validadas con Zod antes de persistir
✅ Paginación: ningún findMany() sin take en endpoints de listado
✅ Asientos contables: sum(debit) === sum(credit) verificado
✅ Transacciones: efectos secundarios (emails, webhooks) fuera de $transaction
✅ Errores de Prisma: P2002, P2025, P2003 capturados y traducidos al español
```

### 🟡 ARQUITECTURA — Fallo = deuda técnica

```
✅ El controller no contiene lógica de negocio ni queries Prisma directas
✅ Las excepciones tienen mensajes en español orientados al usuario final
✅ Los crons capturan todas las excepciones (nunca propagan el throw)
✅ Los crons son idempotentes (N ejecuciones = 1 ejecución en resultado)
✅ Operaciones pesadas (DIAN, OCR, email): no síncronas en el request HTTP
✅ UsageService.checkLimit() llamado antes de la operación, recordUsage() después
```

### 🟢 SCHEMA — Fallo = migration failure en producción

```
✅ Columnas nuevas en tablas existentes: tienen @default() o son String?
✅ Relaciones nuevas: onDelete correcto (Cascade / SetNull / Restrict)
✅ Índices añadidos para columnas de filtro frecuente
✅ Nombre de la migration es descriptivo, no genérico
```

### 🔵 MÓDULO — Fallo = el feature no funciona al desplegar

```
✅ El módulo nuevo está en el array imports[] de AppModule
✅ El scheduler nuevo está en providers[] de su módulo
✅ Las variables de entorno nuevas están en REQUIRED_ENV_VARS o documentadas en .env.example
✅ El service tiene mínimo 4 tests (happy path, tenant isolation, error, quota)
```

---

*Versión 2.0 — Reemplaza completamente la versión 1.0. Derivada del código real del proyecto (commits hasta Mayo 2026).*  
*Si una convención del proyecto contradice estas reglas, las reglas ganan. Si ambas son ambiguas, escalar antes de implementar.*
