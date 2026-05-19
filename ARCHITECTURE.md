# Contex360 Backend — Documentación de Arquitectura

## 1. Estructura del Proyecto

```
contex360.backend/
├── src/
│   ├── main.ts                        # Bootstrap: CORS, pipes, Swagger, servidor
│   ├── app.module.ts                  # Módulo raíz
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── auth-user.decorator.ts # @AuthUser() — extrae usuario del JWT
│   │   │   └── tenant.decorator.ts    # @TenantId() — extrae tenant del header
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── rls-context.interceptor.ts  # Inyecta contexto RLS en cada request
│   │   └── env-validator.ts
│   └── modules/
│       ├── admin/          # Administración del sistema (super-admin)
│       ├── ai/             # Chat e insights con Groq AI
│       ├── analytics/      # KPIs, reportes, exportaciones, OCR
│       ├── auth/           # JWT, OAuth, TOTP, sesiones, RBAC
│       ├── database/       # PrismaService (singleton)
│       ├── demo/           # Solicitudes de demo / CRM pre-venta
│       ├── dian/           # Facturación electrónica DIAN (SOAP/XML)
│       ├── health/         # Health check
│       ├── integrations/   # Gmail OAuth + Bancolombia Open Finance
│       ├── inventory/      # Movimientos de inventario y kardex
│       ├── invoices/       # Facturas de venta
│       ├── ledger/         # Contabilidad (asientos)
│       ├── notification/   # Servicio de correo (Nodemailer)
│       ├── products/       # Catálogo de productos
│       ├── purchases/      # Órdenes de compra
│       ├── quotes/         # Cotizaciones
│       ├── subscriptions/  # Planes y pagos (Wompi)
│       ├── support/        # Tickets de soporte
│       ├── third-parties/  # Clientes, proveedores, empleados
│       └── treasury/       # Caja / Banco / Flujo de caja
├── prisma/
│   └── schema.prisma
├── .env / .env.example
├── nest-cli.json
├── tsconfig.json
└── package.json
```

---

## 2. Tecnologías Usadas

| Categoría | Tecnología | Versión |
|---|---|---|
| Framework | NestJS | 11.x |
| HTTP Server | Express | 5.x |
| Lenguaje | TypeScript | 6.x |
| ORM | Prisma | 6.9 |
| Base de datos | PostgreSQL | — |
| Autenticación | JWT (`@nestjs/jwt`) + bcryptjs | — |
| 2FA | otplib (TOTP) | 13.x |
| OAuth | Google + Bancolombia | — |
| IA | Groq SDK | 1.2 |
| Email | Nodemailer + Gmail API | — |
| DIAN | SOAP (`soap`) + XML signing (`xml-crypto`) | — |
| Pagos | Wompi (webhook) | — |
| Documentación | Swagger (`@nestjs/swagger`) | 11.x |
| Rate limiting | `@nestjs/throttler` | 6.x |
| Scheduler | `@nestjs/schedule` | 5.x |
| Validación | class-validator + class-transformer | — |
| Testing | Vitest | 4.x |
| Build | SWC + tsc | — |
| Deploy | Railway (Node ≥ 20, 384 MB RAM) | — |

---

## 3. Flujos Principales

### 3.1 Autenticación

```
Cliente → POST /auth/login (email + password)
  → AuthService valida credenciales (bcrypt)
  → Verifica 2FA si está habilitado (TOTP)
  → Emite access_token (JWT, 15 min) + refresh_token (cookie httpOnly)
  → Registra UserSession con fingerprint de dispositivo

Cliente → GET /auth/oauth/google
  → Redirige a Google
  → Callback: /auth/oauth/google/callback
  → Crea/actualiza User + emite tokens

Cliente → POST /auth/refresh
  → Valida refresh_token en BD
  → Emite nuevo access_token

Cliente → POST /auth/forgot-password → email con token
Cliente → POST /auth/reset-password  → valida token, actualiza hash
```

### 3.2 Multi-tenancy

Cada request autenticado lleva el header `x-tenant-id`. El `RlsContextInterceptor` lo inyecta en el contexto de Prisma. Todos los modelos de negocio tienen `tenantId` y se filtran por él en cada consulta.

```
Request → AuthGuard (verifica JWT)
        → RlsContextInterceptor (inyecta tenantId)
        → PermissionsGuard (verifica permiso RBAC del rol en Membership)
        → Controller → Service → Prisma (where: { tenantId })
```

### 3.3 Ciclo de Facturación

```
1. Crear cotización (Quote) → estado: draft
2. Enviar al cliente → estado: sent
3. Aceptada → convertir a Invoice (POST /quotes/:id/convert)
4. Invoice emitida → opcionalmente enviar a DIAN (POST /dian/invoices/:id/send)
5. DIAN retorna CUFE/UUID → estado: accepted
6. Pago registrado → Transaction (INCOME) vinculada a Invoice
```

### 3.4 Inventario

```
Venta (InvoiceItem) → descuenta stock automáticamente → InventoryMovement (salida)
Compra (PurchaseItem) → incrementa stock → InventoryMovement (entrada)
Ajuste manual → POST /inventory/movements
Consultar historial → GET /inventory/kardex/:productId
```

### 3.5 Integración Bancolombia

```
POST /integrations/bancolombia/connect → redirige a OAuth Bancolombia
GET  /integrations/bancolombia/callback → guarda tokens cifrados (AES) en IntegrationCredential
POST /integrations/bancolombia/sync → consulta extractos via Open Finance API
                                    → crea Transactions en tesorería
```

### 3.6 Suscripciones / Pagos

```
POST /subscriptions/checkout → crea link de pago en Wompi
Wompi → POST /subscriptions/wompi-webhook → verifica firma HMAC
                                           → actualiza Subscription (planType, renewsAt)
```

### 3.7 AI / Insights

```
POST /ai/chat    → Groq LLM (llama) con contexto del negocio
GET  /ai/insights → genera KPIs del dashboard y los pasa al LLM para análisis
POST /ai/translate → traducción de textos
```

---

## 4. Modelos de Datos (Schema Prisma)

### Enums

| Enum | Valores |
|---|---|
| `UserStatus` | `active`, `inactive`, `pending` |
| `ThirdPartyKind` | `client`, `provider`, `employee` |
| `TaxRegime` | `simplificado`, `comun`, `especial` |
| `InvoiceStatus` | `draft`, `emitted`, `sent`, `accepted`, `cancelled` |
| `QuoteStatus` | `draft`, `sent`, `accepted`, `rejected`, `converted` |
| `PurchaseStatus` | `draft`, `registered`, `paid`, `cancelled` |
| `InventoryMovementType` | `entrada`, `salida` |
| `InventoryTransferStatus` | `pendiente`, `en_transito`, `completado`, `cancelado` |
| `TransactionType` | `INCOME`, `EXPENSE` |
| `TransactionCategory` | `CAJA`, `BANCO`, `PETTY_CASH` |
| `AuditSeverity` | `info`, `warning`, `error`, `critical` |
| `DemoRequestStatus` | `nuevo`, `contactado`, `demo_agendada`, `aprobado`, `convertido`, `cliente`, `rechazado` |
| `SupportTicketStatus` | `abierto`, `en_proceso`, `resuelto`, `cerrado` |
| `SupportTicketPriority` | `baja`, `media`, `alta`, `critica` |

### Modelos

#### `User`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `name` | `String` | Nombre completo |
| `email` | `String` | Único |
| `status` | `UserStatus` | Estado de la cuenta |
| `passwordHash` | `String?` | Hash bcrypt |
| `isSystemOwner` | `Boolean` | Super-administrador |
| `isDemoAccount` | `Boolean` | Cuenta de prueba |
| `deactivateAt` | `DateTime?` | Baja programada |
| `policyAcceptedAt` | `DateTime?` | Aceptación de términos |

Relaciones: `memberships`, `securityProfile`, `sessions`, `refreshTokens`, `auditEvents`

---

#### `Tenant`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `String` (cuid) | PK |
| `name` | `String` | Nombre de la empresa |
| `prefix` | `String` | Único — slug del tenant |
| `nit` | `String?` | NIT Colombia |
| `invoicePrefix` | `String` | Prefijo de facturas (`FV`) |
| `lastInvoiceNumber` | `Int` | Consecutivo actual |
| `dianEnvironment` | `String` | `test` / `production` |
| `dianCertificate` | `String?` | Certificado Base64 |
| `securitySettings` | `Json` | Políticas de seguridad |
| `subscription` | `Subscription?` | Plan activo |

---

#### `Membership`
Relaciona `User` ↔ `Tenant` con un `role` (string RBAC).

---

#### `ThirdParty`
Clientes, proveedores o empleados del tenant. Incluye datos fiscales colombianos (`taxRegime`, `fiscalResponsibilities`).

---

#### `Product`
| Campo | Tipo | Descripción |
|---|---|---|
| `sku` | `String` | Único por tenant |
| `price` | `Decimal(14,2)` | Precio de venta |
| `cost` | `Decimal(14,2)` | Costo |
| `taxRate` | `Decimal(5,2)` | IVA % |
| `stock` | `Int` | Stock total |
| `stockByLocation` | `Json` | Stock por bodega |
| `isInventoriable` | `Boolean` | Controla stock |
| `kitComponents` | `Json?` | Para productos kit |

---

#### `Invoice` / `InvoiceItem`
Factura de venta con ítems de línea. Estado DIAN trazable via `timeline` (Json). Vinculada a `Transaction` al registrar pago.

#### `Quote` / `QuoteItem`
Cotización convertible a `Invoice`. Guarda `convertedToInvoiceId` al convertir.

#### `Purchase` / `PurchaseItem`
Orden de compra a proveedor. Similar estructura a Invoice.

---

#### `LedgerEntry` / `LedgerLine`
Asiento contable con débitos y créditos. `referenceType` indica el origen (`invoice`, `purchase`, etc.).

---

#### `InventoryMovement`
Registro de cada entrada/salida de stock con usuario, lote, fecha de vencimiento y referencia al documento origen.

#### `InventoryTransfer`
Transferencia entre ubicaciones dentro del mismo tenant.

---

#### `Transaction`
Movimiento de caja/banco. Se crea automáticamente al marcar facturas/compras como pagadas, o manualmente desde tesorería.

---

#### `UserSecurityProfile`
2FA, historial de contraseñas, intentos fallidos, bloqueo temporal, huellas de dispositivos confiados.

#### `UserSession`
Sesión activa con IP, dispositivo, OS, navegador y fingerprint. Revocable individualmente.

#### `RefreshToken`
Hash del refresh token con expiración y referencia a sesión.

---

#### `AuditEvent`
Log de auditoría con actor, entidad, acción y severidad. Cumplimiento regulatorio.

#### `RoleAccessHistory`
Historial de cambios en permisos RBAC por rol/módulo.

---

#### `IntegrationCredential`
Tokens OAuth de integraciones externas (Gmail, Bancolombia). Access/refresh tokens cifrados.

#### `Subscription`
Plan activo del tenant (`planType`, `renewsAt`, `invoicesThisMonth`).

#### `SupportTicket`
Ticket de soporte con prioridad y estado de resolución.

#### `DemoRequest`
Pipeline de pre-venta para demos y conversión a cliente.

#### `OcrRun`
Resultado de escaneo OCR de documentos con campos extraídos y nivel de confianza.

---

### Diagrama de Relaciones (simplificado)

```
Tenant ──< Membership >── User
  │                         │
  ├──< ThirdParty            ├── UserSecurityProfile
  ├──< Product               ├── UserSession
  ├──< Invoice >── InvoiceItem── Product
  ├──< Quote   >── QuoteItem  ── Product
  ├──< Purchase>── PurchaseItem─ Product
  ├──< LedgerEntry >── LedgerLine
  ├──< InventoryMovement ── Product
  ├──< Transaction
  ├──< OcrRun
  ├──< IntegrationCredential
  └── Subscription
```

---

## 5. Endpoints Principales

> Base URL: `http://localhost:3001`  
> Documentación interactiva: `GET /docs` (Swagger)

### Auth — `/auth`

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| `POST` | `/auth/login` | Login email/contraseña | Público |
| `POST` | `/auth/forgot-password` | Solicitar reset de contraseña | Público |
| `POST` | `/auth/reset-password` | Resetear contraseña con token | Público |
| `POST` | `/auth/refresh` | Renovar access token | Cookie |
| `GET` | `/auth/oauth/:provider` | Iniciar OAuth (google) | Público |
| `GET` | `/auth/oauth/:provider/callback` | Callback OAuth | Público |
| `GET` | `/auth/me` | Perfil del usuario actual | JWT |
| `GET` | `/auth/totp/setup` | Configurar 2FA | JWT |
| `POST` | `/auth/totp/confirm` | Confirmar 2FA | JWT |
| `POST` | `/auth/totp/disable` | Desactivar 2FA | JWT |
| `POST` | `/auth/change-password` | Cambiar contraseña | JWT |
| `PATCH` | `/auth/profile` | Actualizar perfil | JWT |
| `POST` | `/auth/logout` | Cerrar sesión | JWT |

### Productos — `/products`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/products` | `view_inventory` |
| `GET` | `/products/:id` | `view_inventory` |
| `POST` | `/products` | `manage_inventory` |

### Terceros — `/third-parties`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/third-parties` | `view_third_parties` |
| `GET` | `/third-parties/:id` | `view_third_parties` |
| `POST` | `/third-parties` | `manage_third_parties` |
| `PUT` | `/third-parties/:id` | `manage_third_parties` |
| `DELETE` | `/third-parties/:id` | `manage_third_parties` |

### Facturas — `/invoices`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/invoices` | `view_billing` |
| `GET` | `/invoices/next-number` | `view_billing` |
| `GET` | `/invoices/overdue` | `view_billing` |
| `GET` | `/invoices/aging` | `view_billing` |
| `GET` | `/invoices/:id` | `view_billing` |
| `POST` | `/invoices` | `manage_billing` |
| `PATCH` | `/invoices/:id/status` | `manage_billing` |
| `DELETE` | `/invoices/:id` | `manage_billing` |
| `POST` | `/invoices/:id/cancel` | `manage_billing` |

### Cotizaciones — `/quotes`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/quotes` | `view_billing` |
| `GET` | `/quotes/:id` | `view_billing` |
| `POST` | `/quotes` | `manage_billing` |
| `PATCH` | `/quotes/:id/status` | `manage_billing` |
| `POST` | `/quotes/:id/convert` | `manage_billing` |
| `DELETE` | `/quotes/:id` | `manage_billing` |

### Compras — `/purchases`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/purchases` | `view_billing` |
| `GET` | `/purchases/next-number` | `view_billing` |
| `GET` | `/purchases/:id` | `view_billing` |
| `POST` | `/purchases` | `manage_billing` |
| `PATCH` | `/purchases/:id/status` | `manage_billing` |
| `DELETE` | `/purchases/:id` | `manage_billing` |

### Inventario — `/inventory`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/inventory/movements` | `view_inventory` |
| `POST` | `/inventory/movements` | `manage_inventory` |
| `GET` | `/inventory/kardex/:productId` | `view_inventory` |

### Contabilidad — `/ledger`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/ledger` | `view_accounting` |
| `POST` | `/ledger` | `manage_accounting` |

### Tesorería — `/treasury`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/treasury` | `view_accounting` |
| `GET` | `/treasury/balance` | `view_accounting` |
| `POST` | `/treasury/transactions` | `manage_accounting` |

### Analítica — `/analytics`

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/analytics/dashboard` | `view_reports` |
| `GET` | `/analytics/alerts` | `view_reports` |
| `GET` | `/analytics/cash-flow-trend` | `view_reports` |
| `GET` | `/analytics/sales-by-month` | `view_reports` |
| `GET` | `/analytics/sales-report` | `view_reports` |
| `GET` | `/analytics/top-products` | `view_reports` |
| `GET` | `/analytics/export/invoices` | `view_reports` |
| `GET` | `/analytics/ocr-runs` | `run_ocr` |
| `POST` | `/analytics/ocr-runs/simulate` | `run_ocr` |
| `POST` | `/analytics/ocr-runs/:id/approve` | `run_ocr` |
| `DELETE` | `/analytics/ocr-runs/:id` | `run_ocr` |

### DIAN (Factura Electrónica) — `/dian`

| Método | Ruta | Permiso |
|---|---|---|
| `POST` | `/dian/invoices/:id/send` | `manage_billing` |
| `GET` | `/dian/invoices/:id/status` | `view_billing` |
| `GET` | `/dian/config` | `view_billing` |
| `GET` | `/dian/config/validate` | `view_billing` |
| `POST` | `/dian/config` | `manage_billing` |

### Integraciones — `/integrations`

| Método | Ruta | Descripción | Permiso |
|---|---|---|---|
| `GET` | `/integrations/gmail/connect` | Iniciar OAuth Gmail | `view_admin` |
| `GET` | `/integrations/gmail/callback` | Callback Gmail | Público |
| `GET` | `/integrations/gmail/status` | Estado conexión | `view_admin` |
| `DELETE` | `/integrations/gmail/disconnect` | Desconectar Gmail | `view_admin` |
| `POST` | `/integrations/gmail/send` | Enviar email | `view_billing` |
| `GET` | `/integrations/bancolombia/config` | Ver config | `view_admin` |
| `POST` | `/integrations/bancolombia/config` | Actualizar config | `view_admin` |
| `POST` | `/integrations/bancolombia/connect` | Iniciar OAuth | `view_admin` |
| `GET` | `/integrations/bancolombia/callback` | Callback OAuth | Público |
| `DELETE` | `/integrations/bancolombia/disconnect` | Desconectar | `view_admin` |
| `POST` | `/integrations/bancolombia/sync` | Sincronizar extractos | `view_admin` |

### AI — `/ai`

| Método | Ruta | Auth |
|---|---|---|
| `POST` | `/ai/chat` | JWT |
| `POST` | `/ai/translate` | JWT |
| `GET` | `/ai/insights` | JWT |
| `GET` | `/ai/health` | Público |

### Suscripciones — `/subscriptions`

| Método | Ruta | Auth |
|---|---|---|
| `GET` | `/subscriptions/current` | JWT |
| `GET` | `/subscriptions/usage` | JWT |
| `POST` | `/subscriptions/checkout` | JWT |
| `POST` | `/subscriptions/wompi-webhook` | Webhook (HMAC) |
| `POST` | `/subscriptions/cancel` | JWT |

### Admin — `/admin` *(solo system owner)*

| Método | Ruta |
|---|---|
| `GET` | `/admin/stats` |
| `GET` | `/admin/tenants` |
| `GET` | `/admin/users` |
| `GET` | `/admin/audit-logs` |
| `GET` | `/admin/compliance` |
| `POST` | `/admin/compliance/access-review` |
| `GET` | `/admin/tenants/:id` |
| `PATCH` | `/admin/tenants/:id` |
| `PATCH` | `/admin/tenants/:id/status` |
| `PATCH` | `/admin/tenants/:id/subscription` |
| `POST` | `/admin/tenants/:id/delete` |
| `DELETE` | `/admin/users/:id/data` |
| `GET` | `/admin/breach-alerts` |
| `POST` | `/admin/breach-alerts/:id/notify` |
| `POST` | `/admin/companies` |

### Otros

| Método | Ruta | Auth |
|---|---|---|
| `GET` | `/health` | Público |
| `POST` | `/demo` | Público |
| `GET` | `/demo` | Público |
| `PUT` | `/demo/:id/status` | Público |
| `POST` | `/demo/:id/convert` | Público |
| `POST` | `/support/tickets` | JWT |
| `GET` | `/support/tickets` | `view_admin` |
| `PUT` | `/support/tickets/:id/status` | `view_admin` |

---

## Variables de Entorno Requeridas

```env
DATABASE_URL=postgresql://user:password@host:5432/contex360
DIRECT_URL=postgresql://user:password@host:5432/contex360
JWT_SECRET=<secreto-largo>
OAUTH_STATE_SECRET=<secreto-oauth>
PORT=3001
CORS_ORIGIN=http://localhost:5173
FRONTEND_URL=http://localhost:5173
BACKEND_PUBLIC_URL=http://localhost:3001

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/auth/oauth/google/callback

# Bancolombia Open Finance
BANCOLOMBIA_CLIENT_ID=
BANCOLOMBIA_CLIENT_SECRET=
BANCOLOMBIA_TOKEN_ENCRYPTION_SECRET=
BANCOLOMBIA_REDIRECT_URI=http://localhost:3001/integrations/bancolombia/callback

# DIAN
DIAN_TEST_WSDL_URL=https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl
DIAN_PROD_WSDL_URL=https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl

# IA
GROQ_API_KEY=gsk_...
```
