# Reglas Backend Inteligentes y Análisis de Producto (Contex360)

Este documento define la especificación técnica de producto, las reglas de negocio y el análisis de arquitectura para el backend de **Contex360 ERP**. Ha sido diseñado analizando las capacidades prometidas en la Landing Page, los flujos UX/UI y las necesidades de un SaaS contable multi-tenant moderno y escalable.

---

## 🚀 1. Análisis de Alineación del SaaS (Landing Page vs. Backend)

De acuerdo con el análisis de la landing page ([LandingPage.vue](file:///c:/Users/camilo/Desktop/contex360.fronted/src/components/LandingPage.vue)) y el esquema de base de datos actual ([schema.prisma](file:///c:/Users/camilo/Desktop/contex360.backend/prisma/schema.prisma)), se detectan los siguientes requerimientos del producto:

### 1.1 Suscripciones, Trials y Checkout (Wompi)
*   **Comportamiento del SaaS:** Se ofrecen 3 planes (*Starter*, *Pyme*, *Enterprise*) con facturación mensual y anual. Se promete un "Trial gratis sin tarjeta de crédito".
*   **Flujo de Checkout:** Al hacer clic en "Comprar ahora", el frontend invoca `businessApi.createSubscriptionCheckout` con el ID del plan y la facturación, esperando una URL de redirección segura a Wompi.
*   **Webhook de Wompi:** El backend requiere un endpoint público expuesto para recibir notificaciones asíncronas de Wompi sobre transacciones aprobadas, canceladas o fallidas, actualizando el estado de la suscripción (`Subscription` y `SubscriptionInvoice`).

### 1.2 Facturación Electrónica DIAN
*   **Comportamiento:** Emisión de facturas electrónicas válidas en menos de 3 segundos (CUFE, XML y representación gráfica PDF).
*   **Configuración por Tenant:** Cada Tenant guarda sus certificados `.pfx` en Base64, contraseñas, resoluciones de facturación, prefijos y folios vigentes.

### 1.3 Automatización Contable y Ledger
*   **Comportamiento:** Los asientos contables deben generarse automáticamente tras ventas (invoices), compras (purchases) y transacciones financieras (transactions). El usuario no requiere conocimientos contables avanzados.

### 1.4 Inteligencia Artificial (ContexAI y OCR)
*   **Comportamiento:** Lectura de facturas físicas de proveedores mediante OCR (modelo `OcrRun`) y asistente financiero que elabora borradores de estados financieros (balance, PyG).

---

## 🛠️ 2. GAP Analysis: Nuevas APIs y Endpoints Faltantes

Para cubrir las promesas comerciales y flujos de usuario detectados, se deben construir e integrar los siguientes endpoints en el backend:

### A. Módulo de Suscripción y Pasarela (Wompi)
1.  `POST /api/v1/subscriptions/checkout`
    *   **Propósito:** Genera el enlace de pago de Wompi e inicializa un registro en `Payment` con estado `pending`.
    *   **Validación:** Verifica que el Tenant no tenga un pago pendiente idéntico activo.
2.  `POST /api/v1/subscriptions/webhook`
    *   **Propósito:** Endpoint público para notificaciones de Wompi.
    *   **Seguridad:** Valida la firma del webhook usando la llave secreta (`WOMPI_EVENTS_PROPERTIES_SIGNATURE`). Debe implementar **idempotencia** mediante el ID de transacción de Wompi para evitar duplicación de abonos.

### B. Módulo de Onboarding e Importación
1.  `POST /api/v1/onboarding/import/third-parties`
2.  `POST /api/v1/onboarding/import/products`
    *   **Propósito:** Carga masiva de catálogos mediante Excel/CSV (prometido en FAQ de la Landing).
    *   **Regla:** Validaciones estrictas de duplicidad de NIT (para terceros) y SKU (para productos) por cada fila antes de insertar en base de datos.
3.  `POST /api/v1/onboarding/migrate/siigo`
    *   **Propósito:** Conector para migración automatizada de datos desde Siigo u otros ERPs.

### C. Módulo Contable y Automatización
1.  `GET /api/v1/reports/balance-sheet`
2.  `GET /api/v1/reports/income-statement` (Pérdidas y Ganancias)
    *   **Propósito:** Generación de estados financieros en tiempo real basados exclusivamente en el libro contable (`LedgerEntry` y `LedgerLine`).
3.  `POST /api/v1/transactions/reconcile`
    *   **Propósito:** Conciliación bancaria. Cruza registros de `Transaction` (extracto bancario) contra `LedgerEntry` (asientos manuales o automáticos).

### D. Módulo de Inteligencia Artificial (ContexAI)
1.  `POST /api/v1/ai/ocr-upload`
    *   **Propósito:** Sube facturas en formato PDF/Imagen, ejecuta OCR y extrae campos semánticos mediante LLM guardando el resultado en `OcrRun`.
2.  `POST /api/v1/ai/financial-advisor`
    *   **Propósito:** Agente conversacional contable. Genera análisis financiero del rendimiento del Tenant basándose en el historial de transacciones y estados financieros.

---

## 🗄️ 3. Modificaciones Necesarias en el Modelo de Datos (Prisma)

El esquema de datos requiere adaptaciones para soportar flujos avanzados del SaaS:

1.  **Modelo `Tenant`:**
    *   Añadir columna `dianResolutionAlertThreshold: Int @default(50)` para avisar al usuario cuando le queden pocos folios de facturación disponibles.
    *   Añadir columna `onboardingStep: String @default("enterprise_info")` para guiar al usuario a través del onboarding inicial paso a paso.
2.  **Modelo `Subscription`:**
    *   Añadir `trialPeriodDays: Int @default(14)`.
    *   Añadir `status: String @default("trialing")` para rastrear si el usuario está en período de prueba (`trialing`), activo (`active`), impago (`past_due`) o cancelado (`canceled`).
3.  **Modelo `OcrRun`:**
    *   Añadir relación con `Purchase` (`purchaseId: String? @unique`) para vincular una factura digitalizada directamente con el registro de compra que generó.

---

## ⚠️ 4. Deuda Técnica, Riesgos y Escalabilidad

Durante el análisis del backend se detectan los siguientes riesgos arquitectónicos que deben corregirse bajo estándares de ingeniería de software enterprise:

### 4.1 Deuda Técnica y Riesgos de Rendimiento
*   **Emisión Síncrona DIAN:** El proceso de habilitación tecnológica y comunicación con los servidores de la DIAN suele tardar más de 3 segundos. Si este proceso se realiza de forma síncrona en el hilo principal de la petición HTTP, bloqueará el Event Loop de Node.js bajo alto tráfico.
    *   *Solución:* Implementar un sistema de colas asíncronas (mediante Redis y `@nestjs/bull`) para el envío de facturas y control de reintentos ante caídas del servidor de la DIAN.
*   **Serialización de Stock por Ubicación:** El modelo `Product` almacena existencias en formato JSON (`stockByLocation: Json`). Esto impide realizar filtros rápidos a nivel de base de datos para saber cuántos productos hay en una ubicación específica sin deserializar el registro entero.
    *   *Solución:* Normalizar en una tabla intermedia `ProductLocationStock` con índices en `productId` y `locationId`.

### 4.2 Riesgos de Seguridad
*   **Firma del Webhook de Wompi:** Si el webhook `/api/v1/subscriptions/webhook` no verifica la firma criptográfica enviada por Wompi, un atacante podría enviar payloads falsos para simular pagos exitosos y obtener acceso a planes Premium de forma gratuita.
    *   *Mecanismo de mitigación:* Implementar un Guardia (`Guard`) que compute el hash SHA-256 del cuerpo de la petición con la firma secreta del webhook antes de procesar el pago.
*   **Aislamiento en Queries Complejas:** Al realizar queries contables o reportes de IA que involucren consultas crudas (`$queryRaw`), existe un alto riesgo de fuga de datos de otros Tenants si se omite el parámetro `tenantId`.
    *   *Mecanismo de mitigación:* Implementar un middleware de base de datos de Prisma que inyecte de manera automática la cláusula `AND "tenantId" = X` en todas las operaciones del cliente Prisma.

### 4.3 Problemas de Escalabilidad del SaaS
*   **Rate Limiting en Memoria:** Actualmente, el rate limiting se gestiona en memoria. En un despliegue multi-instancia detrás de un balanceador de carga, el límite no se compartirá y un atacante podrá sortearlo haciendo peticiones distribuidas.
    *   *Solución:* Configurar `@nestjs/throttler` para utilizar un almacén centralizado en Redis (`throttler-storage-redis`).
*   **Carga de Archivos de Facturas (OCR):** El almacenamiento de imágenes y PDFs de facturas en el disco local del contenedor fallará en entornos serverless o de auto-escalado.
    *   *Solución:* Configurar la subida de archivos directamente a Amazon S3 o Cloudflare R2 y almacenar únicamente la URL firmada en la base de datos.

---

## 🤖 5. Reglas para Integración de Inteligencia Artificial (ContexAI)

El backend debe aplicar medidas estrictas de control al conectarse con LLMs externos para proteger los datos financieros del ERP:

1.  **Sanitización antes del envío al LLM:** Toda información financiera enviada a la API de OpenAI/Anthropic/Gemini para análisis debe ser anonimizada en el backend. Elimina nombres reales de clientes, NITs y datos personales sensibles antes de enviar el prompt.
2.  **Validación de Salida (Parser Guard):** Dado que la IA genera borradores contables y análisis financieros, la respuesta del LLM debe ser validada sintácticamente mediante esquemas de validación (Zod) antes de ser consumida por los servicios de negocio del ERP para evitar que datos mal formateados corrompan la base de datos contable.
3.  **Cost Control (Rate Limiting de Tokens):** Implementar límites específicos en el consumo del módulo de IA por usuario/tenant para prevenir que llamadas excesivas (o bots locales) consuman la cuota de la API del proveedor de IA.

---

## 🔐 6. Inmutabilidad e Integridad Contable (CRÍTICO)

> Los registros contables y fiscales son INMUTABLES. Una transacción contable
> no se corrige borrándola: se corrige con un nuevo registro que deja rastro.
> Borrar un asiento rompe la trazabilidad de auditoría, descuadra balances
> históricos y viola la conservación de soportes contables (y la normativa
> DIAN: una factura emitida se anula con nota crédito, no se elimina).

### 6.1 Modelos protegidos (append-only)
`LedgerEntry`, `LedgerLine`, documentos fiscales emitidos (`Invoice`/facturas
DIAN, notas crédito/débito) y todo movimiento que afecte saldos contables.

### 6.2 Operaciones PROHIBIDAS sobre modelos protegidos
*   ❌ `prisma.ledgerEntry.delete(...)` / `deleteMany(...)`
*   ❌ `DELETE FROM "LedgerEntry" ...` vía `$executeRaw` / `$executeRawUnsafe`
*   ❌ Mutar montos de un asiento ya contabilizado (`update` sobre `debit`/`credit`
    de una línea ya posteada).

### 6.3 Operaciones PERMITIDAS (única forma de corregir)
1.  **Reversión:** Crear un asiento de reversa que invierte débitos y créditos
    del original, referenciando su `id`.
2.  **Anulación:** Cambiar el estado lógico (`status: 'voided'` / `annulled`)
    SIN borrar la fila; el registro permanece consultable.
3.  **Asiento compensatorio:** Nuevo asiento que ajusta el saldo, enlazado al
    original por un campo de relación (ej. `reversesEntryId`).

### 6.4 Cumplimiento y tests
*   No exponer métodos `delete`/`remove` en servicios o repositorios de modelos
    protegidos. La corrección se hace vía servicios `reverse()` / `void()`.
*   (Recomendado) Bloquear `delete`/`deleteMany` sobre estos modelos mediante
    un middleware/extensión de Prisma que lance error en runtime.
*   Todo servicio contable debe tener un test que verifique que un intento de
    borrado físico es rechazado, y que reversión/anulación preservan la fila
    original.
