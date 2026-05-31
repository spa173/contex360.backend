# Reglas de Desarrollo Backend Enterprise (Contex360)

Este documento define el estándar de desarrollo de grado empresarial (Enterprise) para el backend de **Contex360 ERP**. Su cumplimiento garantiza una API REST segura, de alto rendimiento, modular, robusta ante fallos, y con un estricto cumplimiento de aislamiento multi-tenant.

---

## 🏛️ 1. Arquitectura Limpia y Modularidad

El backend está construido bajo una arquitectura modular y desacoplada mediante **NestJS**, siguiendo los principios de SOLID y modularidad limpia.

### 1.1 Estructura del Dominio
Cada dominio de negocio (ej. Facturación, Inventario, Clientes) debe estar encapsulado en su propio módulo, exponiendo interfaces claras y ocultando detalles de implementación.
*   **Decoupling:** Los módulos deben comunicarse entre sí mediante inyección de dependencias (`Dependency Injection`) y nunca mediante acoplamiento directo o referencias circulares. Si dos módulos se necesitan mutuamente, extrae la funcionalidad común a un tercer módulo o utiliza eventos locales de NestJS (`EventEmitterModule`).
*   **Módulos Core vs. Módulos de Dominio:**
    *   **Core:** Transversales a la aplicación (`PrismaModule`, `AuthModule`, `NotificationModule`, `ConfigModule`).
    *   **Dominio:** Módulos que implementan casos de uso del negocio (`AccountingModule`, `InventoryModule`, `BillingModule`).

---

## 🛡️ 2. Validaciones y DTOs (Data Transfer Objects)

La validación y el saneamiento de datos en la frontera de la API son obligatorios.

### 2.1 Uso Estricto de DTOs con class-validator
Toda petición HTTP `POST`, `PUT`, `PATCH` debe tener un DTO definido y decorado adecuadamente para validar los datos en tiempo de ejecución.

```typescript
import { IsString, IsNotEmpty, IsEmail, IsOptional, Length } from 'class-validator';

export class CreateThirdPartyDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 100)
  readonly name: string;

  @IsEmail()
  @IsNotEmpty()
  readonly email: string;

  @IsString()
  @IsOptional()
  readonly nit?: string;
}
```

### 2.2 Saneamiento de Datos (Sanitization)
*   **Propiedades no deseadas:** El `ValidationPipe` global debe estar configurado para eliminar cualquier propiedad que no esté explícitamente definida en el DTO (`whitelist: true`), y lanzar un error si se envían campos extraños (`forbidNonWhitelisted: true`).
    ```typescript
    // En main.ts
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true, // Convierte tipos automáticamente según la firma del DTO
    }));
    ```
*   **Sanitización XSS:** Para entradas de texto que admitan caracteres especiales, sanea el contenido antes de guardarlo en la base de datos usando librerías de saneamiento (como `class-sanitizer` o filtros personalizados en los servicios).

---

## 🔒 3. Seguridad Enterprise y Rate Limiting

### 3.1 Rate Limiting (Protección Anti-Scraping / DoS)
*   Se aplica limitación de tasa por Tenant y dirección IP utilizando el módulo `@nestjs/throttler`.
*   **Límite Estándar:** Máximo 100 peticiones por minuto. Al exceder el límite, la API debe responder con HTTP 429 Too Many Requests.
*   Los endpoints sensibles (como `/auth/login` o `/auth/reset-password`) deben tener límites más restrictivos (máximo 5 intentos por minuto).

### 3.2 Prevención de Inyección SQL
*   Prisma ORM parametriza automáticamente todas las consultas.
*   **Prohibido:** Utilizar métodos inseguros de ejecución de consultas crudas concatenando cadenas.
*   ❌ **Mal:** `await this.prisma.$queryRawUnsafe("SELECT * FROM \"Tenant\" WHERE name = '" + tenantName + "'")`
*   ✅ **Bien:** `await this.prisma.$queryRaw`SELECT * FROM "Tenant" WHERE name = ${tenantName}``

### 3.3 Aislamiento Multi-Tenant — Auditoría Obligatoria (CRÍTICO)

> ⚠️ Esta es la regla de seguridad más importante del ERP. Una fuga
> multi-tenant expone datos de un cliente a otro y es silenciosa hasta que
> alguien ve datos ajenos. NINGÚN endpoint nuevo o modificado se aprueba sin
> cumplir y demostrar en el PR los 5 puntos siguientes.

1.  **Origen del `tenantId`:** Obtenido SIEMPRE desde el JWT (vía guard/decorador,
    ej. `@CurrentTenant()`), NUNCA desde el `body`, `query` o `params` enviados
    por el cliente.
2.  **Lecturas filtradas:** Todo `findFirst` / `findMany` / `count` / `aggregate`
    incluye `tenantId` en el `where`. Prohibido `findUnique` por `id` solo (no
    permite filtrar por tenant) — usar `findFirst({ where: { id, tenantId } })`.
3.  **Escrituras filtradas:** `create` setea `tenantId`; `update` / `delete` /
    `updateMany` / `deleteMany` filtran por `tenantId` en el `where`. Prohibido
    `update({ where: { id } })` sin verificar la pertenencia al tenant.
4.  **Relaciones filtradas:** Todo `include` / `select` anidado y toda conexión
    (`connect`) valida que la entidad relacionada pertenece al mismo tenant.
5.  **Cobertura de tests:** Existe al menos un test que verifica que un tenant
    NO puede leer ni modificar un registro de otro tenant (espera `404`/`403`,
    nunca el dato ajeno).

Todos los servicios de negocio deben recibir el `tenantId` validado y filtrar
explícitamente cada consulta en Prisma:
    ```typescript
    async findOne(id: string, tenantId: string) {
      const record = await this.prisma.product.findFirst({
        where: { id, tenantId }
      });
      if (!record) throw new NotFoundException('Producto no encontrado');
      return record;
    }
    ```

---

## ⚡ 4. Rendimiento y Optimización de Base de Datos

### 4.1 Indexación en PostgreSQL
*   Toda tabla que contenga la columna `tenantId` debe tener un índice compuesto o individual para optimizar las consultas:
    ```prisma
    model Product {
      id        String  @id @default(uuid())
      name      String
      tenantId  String
      
      @@index([tenantId]) // Optimización crítica de indexación
    }
    ```
*   Indexa también las columnas utilizadas frecuentemente en relaciones extranjeras y búsquedas frecuentes (como `email` de usuarios o `nit` de terceros).

### 4.2 Paginación Obligatoria
Queda terminantemente prohibido retornar listas completas de base de datos sin paginación.
*   Todos los endpoints de listado (`GET /products`, `GET /invoices`) deben implementar paginación mediante cursores o compensación (`skip` y `take` en Prisma) con límites por defecto (ej. máximo 50 registros por página).

### 4.3 Gestión de Conexiones (Connection Pooling)
*   En producción, la base de datos PostgreSQL (Neon) debe utilizar un pooler de conexiones (como PgBouncer) configurando el string de conexión con el puerto de pooling correspondiente y especificando límites de pool en la variable de entorno: `postgresql://...?connection_limit=10&pool_timeout=15`.

---

## 🚨 5. Manejo de Errores y Resiliencia

### 5.1 Estructura Estándar de Respuesta de Error
Todas las excepciones retornadas por la API deben tener una estructura uniforme definida por un Filtro de Excepciones Global (`HttpExceptionFilter`):

```json
{
  "statusCode": 400,
  "timestamp": "2026-05-29T19:28:36.000Z",
  "path": "/api/v1/third-parties",
  "message": "El NIT ingresado ya se encuentra registrado",
  "error": "Bad Request"
}
```

### 5.2 Traducción de Excepciones del ORM (Prisma)
El filtro global de excepciones debe capturar errores internos del ORM y transformarlos en excepciones HTTP semánticas:
*   `P2002` (Unique constraint failed) -> `409 Conflict` (Ej: correo duplicado).
*   `P2025` (Record not found) -> `404 Not Found`.
*   `P2003` (Foreign key constraint failed) -> `400 Bad Request` (Ej: intentar eliminar un cliente que tiene facturas asociadas).

---

## 📊 6. Logs y Observabilidad (Logging)

*   **Pino Logger:** Toda la aplicación utiliza `nestjs-pino` para registrar eventos en formato estructurado JSON. Esto permite indexar y buscar logs de forma eficiente en producción.
*   **Niveles de Log:**
    *   `fatal` / `error`: Excepciones no controladas, fallos de infraestructura.
    *   `warn`: Eventos sospechosos o fallos controlados (ej: intentos fallidos de login).
    *   `info`: Operaciones importantes del ciclo de vida de la aplicación y transacciones de negocio.
    *   `debug`: Registros detallados de desarrollo (deben desactivarse en producción).
*   **Correlation ID:** Cada petición HTTP debe generar un identificador único de rastreo (`X-Correlation-Id` en las cabeceras). Este ID debe inyectarse en cada log generado durante el ciclo de vida de la petición para poder rastrear transacciones completas.

---

## 🧪 7. Pruebas Automatizadas (Testing)

El código backend debe estar respaldado por pruebas para asegurar la estabilidad antes del despliegue.

### 7.1 Pruebas Unitarias (Services & Helpers)
*   **Framework:** Vitest.
*   **Práctica:** Mockear el cliente de Prisma (`DeepMockProxy`) para probar la lógica de negocio de los servicios de forma aislada sin tocar la base de datos real.

### 7.2 Pruebas de Integración y E2E (Controllers & API)
*   Prueba los flujos completos de los controladores levantando la aplicación de NestJS en un entorno de pruebas con una base de datos PostgreSQL de test limpia.
*   Asegura la limpieza automática de las tablas (`db:reset`) después de cada ejecución de tests para mantener la idempotencia.

---

## 🔑 8. Variables de Entorno y Configuración Corporativa

*   **Validación de Inicio (Startup Validation):** El backend no debe iniciar si faltan variables de entorno críticas. Utiliza un esquema de validación de Zod o `class-validator` con `@nestjs/config` para verificar las variables de entorno en el arranque:
    ```typescript
    import { plainToInstance } from 'class-transformer';
    import { validateSync } from 'class-validator';

    export function validateEnv(config: Record<string, unknown>) {
      const validatedConfig = plainToInstance(EnvironmentVariablesDto, config, {
        enableImplicitConversion: true,
      });
      const errors = validateSync(validatedConfig);
      if (errors.length > 0) {
        throw new Error(`Error de configuración de entorno: ${errors.toString()}`);
      }
      return validatedConfig;
    }
    ```
*   **Certificados en Formato Base64:** Para integrar el sistema de firma de la DIAN, almacena los certificados electrónicos `.pfx` codificados en formato Base64 en la variable `SAAS_DIAN_CERTIFICATE` y descodifícalos en memoria al firmar los XML, evitando guardar archivos sensibles físicamente en el disco.
