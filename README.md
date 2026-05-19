# Contex360 — Backend API

> ERP colombiano multi-tenant. Backend construido con **NestJS + Prisma + PostgreSQL (Neon)**.

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | NestJS 11 |
| ORM | Prisma 6 |
| Base de datos | PostgreSQL via Neon (pooler PgBouncer) |
| Autenticación | JWT access token (15 min) + Refresh token rotado (30 días) |
| Validación | class-validator + ValidationPipe |
| Documentación | Swagger / OpenAPI en `/docs` |
| Rate limiting | @nestjs/throttler (100 req/min · 1000 req/h por IP real) |
| Scheduler | @nestjs/schedule |
| Runtime | Node.js 20+ / TypeScript 5 |

---

## Instalación

```powershell
npm install
copy .env.example .env   # editar con credenciales Neon
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```

Servidor en `http://localhost:3001` · Swagger en `http://localhost:3001/docs`.

---

## Variables de entorno requeridas

```env
# Base de datos (Neon)
DATABASE_URL=postgresql://...?sslmode=require&pgbouncer=true
DIRECT_URL=postgresql://...?sslmode=require

# JWT
JWT_SECRET=<secreto_largo_aleatorio>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<secreto_refresh>
JWT_REFRESH_EXPIRES_IN=7d

# Servidor
PORT=3001
APP_NAME=Contex360 Backend
CORS_ORIGIN=http://localhost:5173

# Swagger
SWAGGER_PATH=docs
```

---

## Estado real por módulo

### ✅ Completamente funcional

**Auth** — login bcrypt, JWT + refresh token rotado, 2FA TOTP, RBAC por rol, sesiones con IP real (trust proxy configurado para Railway/Render), bloqueo por intentos fallidos, historial de contraseñas, derecho al olvido (Art. 15 Ley 1581).

**Facturas** — creación con descuento de stock atómico en transacción, numeración automática por tenant, cancelación con reversión de inventario, cartera vencida y aging por buckets, asiento contable automático al marcar como aceptada.

**Compras** — creación con ingreso de stock, numeración automática, asiento contable doble entrada (gastos + IVA descontable + proveedores), pago con asiento de cancelación.

**Cotizaciones** — CRUD completo, conversión a factura (solo desde estado `accepted`), numeración automática.

**Tesorería** — transacciones INCOME/EXPENSE, balance calculado desde DB, asiento contable automático por movimiento.

**Inventario** — movimientos de entrada/salida, traslados entre bodegas con estados.

**Contabilidad (Ledger)** — asientos doble entrada con validación de cuadre (débitos = créditos ± 0.01), generados automáticamente por facturas, compras y tesorería.

**Terceros** — CRUD de clientes y proveedores.

**Productos** — CRUD básico. Soporta `isInventoriable`, `stock`, `minStock`, `stockByLocation`, kits.

**Analytics** — KPIs de dashboard, ventas por mes, reporte de ventas con comparación de período anterior, top productos, flujo de caja con proyección a 15 días (regresión lineal sobre últimos 7 días), alertas de stock bajo y facturas pendientes.

**Admin console** — stats globales, gestión de tenants y usuarios, compliance dashboard con revisión periódica de accesos (automatizada mensualmente), plan de continuidad, alertas de brechas, creación de empresas con usuario admin temporal.

**DIAN** — generación de XML UBL 2.1, cálculo de CUFE (SHA-384), firma digital con certificado `.p12/.pfx` (node-forge + xml-crypto), transmisión SOAP a habilitación (`SendTestSetAsync`) y producción (`SendBillSync`), consulta de estado (`GetStatus`), timeline por factura, validación de configuración por tenant.

**Bancolombia** — configuración OAuth por tenant, generación de URL de consentimiento, callback con almacenamiento de tokens cifrados, sincronización de extractos MT940/CAMT.053, desconexión. El `client_secret` nunca sale del backend.

**OCR / IA** — extracción de campos desde documentos (Groq), simulación de OCR con datos mock para demo, aprobación que crea compra + proveedor + transacción automáticamente.

**Notificaciones** — alertas de brechas por email (nodemailer).

**Health** — `GET /health` con estado de DB.

---

### ⚠️ Parcial o con limitaciones conocidas

**DIAN en producción** — el flujo SOAP está implementado pero no ha pasado por el proceso de habilitación real con la DIAN. Requiere certificado digital vigente emitido por una entidad autorizada, resolución de facturación activa y testSetId válido. El CUFE se calcula según la especificación técnica v1.9 pero no ha sido validado contra el ambiente de producción.

**Analytics — proyección de flujo de caja** — usa regresión lineal simple sobre los últimos 7 días más ruido sinusoidal. Es orientativa, no un modelo financiero.

**Productos — CRUD** — `create` y `findAll` implementados; `update` y `delete` están en el controller pero el service solo tiene `create` y `findAll`. Las rutas `PATCH /products/:id` y `DELETE /products/:id` devuelven error hasta que se complete el service.

**OCR real** — `simulateOcrRun` devuelve datos mock hardcodeados (3 facturas de Éxito, Coordinadora y D1). La integración real con Groq está en `ai.service.ts` pero no está conectada al flujo de aprobación de compras.

**Throttler** — configurado pero el guard global está comentado en `app.module.ts`. El rate limiting no está activo en ninguna ruta hasta que se habilite.

---

### ❌ No implementado aún

- Exportación a Excel (solo CSV básico en analytics)
- Notas crédito / débito DIAN
- Firma electrónica de documentos de compra
- Webhooks salientes
- Reportes contables (balance general, estado de resultados, libro mayor)
- Integración bancaria con movimientos reales (Open Finance Bancolombia no entrega saldos ni movimientos, solo valida titularidad)

---

## Arquitectura de módulos

```
src/
├── app.module.ts
├── main.ts                # trust proxy, CORS, Swagger, pipes
├── common/
│   ├── decorators/        # @TenantId, @CurrentUser
│   ├── interceptors/      # LoggingInterceptor, RlsContextInterceptor
│   └── env-validator.ts
└── modules/
    ├── auth/              # JWT, 2FA, RBAC, sesiones, OAuth
    ├── database/          # PrismaModule singleton global
    ├── invoices/          # Facturación + DIAN timeline
    ├── purchases/         # Compras + stock + ledger
    ├── quotes/            # Cotizaciones
    ├── treasury/          # Tesorería + ledger automático
    ├── ledger/            # Asientos contables doble entrada
    ├── inventory/         # Movimientos y traslados
    ├── products/          # Catálogo de productos
    ├── third-parties/     # Clientes y proveedores
    ├── dian/              # XML UBL 2.1, CUFE, SOAP
    ├── analytics/         # KPIs, reportes, flujo de caja
    ├── ai/                # OCR con Groq
    ├── admin/             # Consola global + compliance
    ├── integrations/      # Bancolombia OAuth + extractos
    ├── notification/      # Email de alertas
    ├── support/           # Tickets de soporte
    ├── demo/              # Solicitudes de demo
    └── health/            # Health check
```

### Patrón por módulo

```
Controller → Guard (JWT + RBAC) → Service → PrismaService → Neon DB
```

El tenant activo se resuelve desde el header `x-tenant-id` via `@TenantId()`.

---

## Endpoints principales

### Auth — `/auth`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/login` | ❌ | Login email + password + TOTP opcional |
| GET | `/auth/me` | JWT | Usuario + memberships + sesión activa |
| POST | `/auth/refresh` | ❌ | Rotar refresh token |
| POST | `/auth/logout` | JWT | Revocar sesión |
| GET | `/auth/sessions` | JWT | Sesiones activas del usuario |
| POST | `/auth/change-password` | JWT | Cambio de contraseña con historial |
| PATCH | `/auth/profile` | JWT | Actualizar nombre y título |

### Facturas — `/invoices`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/invoices` | JWT | Listar facturas del tenant |
| GET | `/invoices/next-number` | JWT | Preview del próximo número |
| GET | `/invoices/overdue` | JWT | Cartera vencida |
| GET | `/invoices/aging` | JWT | Aging por buckets (0/30/60/90/90+) |
| GET | `/invoices/:id` | JWT | Detalle con timeline DIAN |
| POST | `/invoices` | JWT | Crear + descontar stock + asiento |
| PATCH | `/invoices/:id/status` | JWT | Actualizar estado |
| POST | `/invoices/:id/cancel` | JWT | Cancelar + revertir stock |
| DELETE | `/invoices/:id` | JWT | Eliminar draft |

### DIAN — `/dian`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/dian/config` | JWT | Configuración DIAN del tenant |
| POST | `/dian/config` | JWT | Guardar configuración + certificado |
| POST | `/dian/validate` | JWT | Validar configuración antes de enviar |
| POST | `/dian/send/:invoiceId` | JWT | Transmitir factura (test o producción) |
| GET | `/dian/status/:invoiceId` | JWT | Consultar estado en DIAN |

### Compras — `/purchases`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/purchases` | JWT | Listar compras |
| GET | `/purchases/next-number` | JWT | Preview del próximo número |
| POST | `/purchases` | JWT | Crear + ingresar stock + asiento |
| PATCH | `/purchases/:id/status` | JWT | Actualizar estado (paid genera asiento) |
| DELETE | `/purchases/:id` | JWT | Eliminar |

### Cotizaciones — `/quotes`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/quotes` | JWT | Listar cotizaciones |
| POST | `/quotes` | JWT | Crear |
| PATCH | `/quotes/:id/status` | JWT | Actualizar estado |
| POST | `/quotes/:id/convert` | JWT | Convertir a factura (requiere `accepted`) |
| DELETE | `/quotes/:id` | JWT | Eliminar |

### Tesorería — `/treasury`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/treasury` | JWT | Listar transacciones |
| GET | `/treasury/balance` | JWT | Balance + ingresos/gastos del mes |
| POST | `/treasury/transactions` | JWT | Registrar movimiento + asiento |

### Analytics — `/analytics`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/analytics/kpis` | JWT | KPIs del dashboard |
| GET | `/analytics/sales` | JWT | Ventas por mes |
| GET | `/analytics/sales-report` | JWT | Reporte con comparación de período |
| GET | `/analytics/top-products` | JWT | Productos más vendidos |
| GET | `/analytics/cash-flow` | JWT | Flujo de caja histórico + proyección |
| GET | `/analytics/alerts` | JWT | Alertas de stock y facturas pendientes |
| GET | `/analytics/export/invoices` | JWT | Exportar facturas CSV |

### Bancolombia — `/integrations/bancolombia`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/integrations/bancolombia/config` | JWT | Configuración por tenant |
| POST | `/integrations/bancolombia/config` | JWT | Guardar modo, cuenta, clientId |
| POST | `/integrations/bancolombia/connect` | JWT | Generar URL de consentimiento OAuth |
| GET | `/integrations/bancolombia/callback` | Pública | Recibir code y guardar tokens |
| DELETE | `/integrations/bancolombia/disconnect` | JWT | Revocar y limpiar credenciales |
| POST | `/integrations/bancolombia/sync` | JWT | Sincronizar extracto MT940/CAMT.053 |

### Admin — `/admin`

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/admin/stats` | Admin | Stats globales del sistema |
| GET | `/admin/tenants` | Admin | Listar empresas |
| GET | `/admin/tenants/:id` | Admin | Detalle con memberships y contadores |
| PATCH | `/admin/tenants/:id` | Admin | Actualizar empresa |
| PATCH | `/admin/tenants/:id/subscription` | Admin | Actualizar plan |
| PATCH | `/admin/tenants/:id/status` | Admin | Activar / suspender |
| POST | `/admin/tenants/:id/delete` | Admin | Eliminar empresa (requiere contraseña) |
| POST | `/admin/companies` | Admin | Crear empresa + admin con clave temporal |
| GET | `/admin/users` | Admin | Listar usuarios globales |
| DELETE | `/admin/users/:id/data` | Admin | Anonimizar datos (derecho al olvido) |
| GET | `/admin/audit-logs` | Admin | Últimos 100 eventos de auditoría |
| GET | `/admin/compliance` | Admin | Dashboard de compliance |
| POST | `/admin/compliance/access-review` | Admin | Ejecutar revisión de accesos manual |
| GET | `/admin/breach-alerts` | Admin | Alertas de severidad error/critical |
| POST | `/admin/breach-alerts/:id/notify` | Admin | Notificar brecha por email |

---

## Seguridad

- Rutas protegidas requieren `Authorization: Bearer <accessToken>`
- Tenant activo en header `x-tenant-id`
- `trust proxy 1` configurado — rate limiting y sesiones usan IP real del cliente
- Rate limiting: 100 req/min · 1000 req/h por IP (guard global pendiente de activar)
- Contraseñas hasheadas con bcrypt (12 rounds)
- Refresh tokens almacenados como hash SHA-256, rotados en cada uso
- Tokens Bancolombia cifrados en DB con clave del servidor
- `client_secret` de Bancolombia nunca sale del backend

---

## Modelos principales

`User` · `Tenant` · `Membership` · `Product` · `Invoice` · `InvoiceItem` · `Purchase` · `PurchaseItem` · `Quote` · `QuoteItem` · `ThirdParty` · `LedgerEntry` · `LedgerLine` · `InventoryMovement` · `InventoryTransfer` · `Transaction` · `UserSession` · `RefreshToken` · `UserSecurityProfile` · `AuditEvent` · `OcrRun` · `Subscription` · `DemoRequest`

---

## Comandos Prisma

```powershell
npx prisma generate          # regenerar cliente tras cambios de schema
npx prisma migrate dev --name <nombre>   # nueva migración
npx prisma migrate deploy    # aplicar en producción
npx prisma studio            # interfaz visual
npx prisma migrate reset     # resetear (destructivo)
```

---

## Usuario de prueba

Ejecuta `npm run db:seed` en un entorno local o de staging. El seed imprime las credenciales generadas una sola vez en stdout — no hay contraseña por defecto.

```powershell
npm run db:seed
# Seed completed successfully.
# Generated passwords (save these — shown only once):
#   root@contex360.local => <token_aleatorio>
#   admin.labs@contex360.local => <token_aleatorio>
#   ...
```

Para producción, crea el primer usuario administrador desde `POST /admin/companies` tras el despliegue inicial.

---

## Variables DIAN

```env
DIAN_TEST_WSDL_URL=https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl
DIAN_TEST_ENDPOINT_URL=https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc
DIAN_PROD_WSDL_URL=https://vpfe.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl
DIAN_PROD_ENDPOINT_URL=https://vpfe.dian.gov.co/WcfDianCustomerServices.svc
```

## Variables Bancolombia

```env
BANCOLOMBIA_CLIENT_ID=<client-id>
BANCOLOMBIA_CLIENT_SECRET=<del-vault>
BANCOLOMBIA_AUTHORIZATION_URL=https://...
BANCOLOMBIA_TOKEN_URL=https://...
BANCOLOMBIA_SCOPE=<scope>
BANCOLOMBIA_REDIRECT_URI=https://api.tudominio.com/integrations/bancolombia/callback
BANCOLOMBIA_TOKEN_ENCRYPTION_SECRET=<clave-larga>
BANCOLOMBIA_STATEMENT_SOURCE_URL=<url-opcional-extractos>
```

---

*Contex360 v0.1.0 — Mayo 2026*
