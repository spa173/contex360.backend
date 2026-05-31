# CONTEXT360_MASTER_CONTEXT.md

Este archivo es la guía de contexto de primer nivel para cualquier agente de IA (Claude, Gemini, Roo, Windsurf, etc.) o desarrollador humano que trabaje en **Contex360**. Consúltalo antes de realizar cualquier cambio.

---

## 1. Proyecto

*   **Nombre:** Contex360 ERP
*   **Tipo de Negocio:** SaaS B2B Multi-tenant para pequeñas y medianas empresas colombianas.
*   **Planes:** Starter (Límite: 50 facturas/mes, 1 usuario), Pyme (Ilimitado, 5 usuarios), Enterprise (Acceso total + 2FA TOTP obligatorio).
*   **Objetivo:** Automatizar la contabilidad operativa, el inventario multi-bodega y la facturación electrónica DIAN en menos de 3 segundos, incorporando ContexAI (asistente financiero y digitalización OCR).

---

## 2. Stack Tecnológico

La plataforma opera con dos repositorios independientes:

### Frontend (`contex360.fronted`)
*   **Core:** Vue 3 (Composition API con `<script setup lang="ts">`) + TypeScript.
*   **Build Tool:** Vite (compilado optimizado con división de chunks manual).
*   **Estilos & Estado:** Tailwind CSS (variables de color semánticas) + Pinia.
*   **Testing & CI/CD:** Vitest (con mocks de globals bajo `window`) + Vercel deployment.

### Backend (`contex360.backend`)
*   **Core:** NestJS (CommonJS, Node >= 20) + TypeScript + SWC para desarrollo rápido.
*   **Persistencia:** PostgreSQL (Neon) + Prisma ORM.
*   **Observabilidad & Logs:** Pino Logger (formato JSON estructurado) + Sentry.
*   **Infraestructura:** Hugging Face Spaces (Docker).

---

## 3. Arquitectura y Estructura

### Frontend Layout
*   `src/components/ui/`: Átomos del sistema de diseño (botones, inputs, modales, etc.).
*   `src/views/` y `src/router/`: Vistas de negocio y rutas configuradas con **lazy-loading**.
*   `src/services/`: Clientes API (`businessApi` usando Axios/Fetch) y manejadores CSRF.

### Backend Layout (Modulación Limpia)
*   `src/modules/`: Módulos de dominio encapsulados (ej. `auth/`, `dian/`, `ledger/`, `ocr/`).
*   **Flujo transaccional en Service:**
    1. Validar Tenant ➔ 2. Validar Límites (UsageService) ➔ 3. Reglas de Negocio ➔ 4. Mutación en Prisma ➔ 5. Efectos Secundarios (Stock/Ledger) ➔ 6. Registrar Uso ➔ *[Fin de $transaction]* ➔ 7. AuditEvent ➔ 8. Webhooks/Emails/Background Jobs.

### Aislamiento Multi-Tenant (Seguridad Crítica)
*   **Ley Absoluta:** Toda consulta a base de datos de negocio debe filtrar por `tenantId` en la cláusula `where`.
*   Toda consulta raw `$queryRaw` debe estar parametrizada (usar interpolación nativa de Prisma, jamás concatenación directa para evitar SQL injection).

---

## 4. Reglas Críticas (Cero Errores)

### Flujo Git y Calidad (Obligatorio)
1.  **Validar local:** Ejecuta `npm run build` + `npm run test` + `npm run lint`.
2.  **Ramas:** Trabaja e integra en la rama `staging`. Crea Pull Request con GitHub CLI (`gh pr create`) hacia `main`. No uses `--force` ni borres `staging`/`main` (protegidas en GitHub).
3.  **SonarQube (Quality Gate PASS):**
    *   Toda función nueva: complejidad cognitiva < 15 y ciclomática < 10.
    *   Tamaño máximo preferente de función: ≤ 50 líneas.
    *   Prohibido dejar variables o imports sin usar.

### Frontend UI/UX y Accesibilidad (WCAG 2.1 AA)
*   **Prohibido hardcodear colores:** Usa variables CSS semánticas (`bg-background`, `bg-surface`, `text-text-muted`, `border-border`) mapeadas a Tailwind para compatibilidad automática de Modo Claro/Oscuro.
*   **Prohibido `transition-all`:** Usa transiciones específicas de propiedades (ej. `transition-transform`) para evitar caídas de FPS.
*   **Navegación Teclado:** Nunca elimines anillos de foco. Usa `focus-visible`. Modales deben atrapar el foco.

### Facturación DIAN y Wompi
*   **Certificados:** Nunca los guardes en disco. Pásalos en Base64 en variables de entorno (`SAAS_DIAN_CERTIFICATE`).
*   **Consecutivos:** Reserva folios dentro de `$transaction`. Un folio asignado **nunca se reutiliza**, aunque la DIAN lo rechace temporalmente (estado `failed` reintentable).
*   **Notas:** Requieren referencia exacta del CUFE original y justificación estandarizada.
*   **Wompi Checkout:** No alteres el flujo de cobros, webhooks o validación de firmas sin aprobación explícita.

---

## 5. Roadmap Resumido (Plan a 12 semanas)

*   **P0 (Semanas 1-2):** Quotas de Starter (límite 50 facturas), Importador masivo Excel (Terceros/Productos), reportes Balance General y P&G, API pública de Demos.
*   **P1 (Semanas 3-6):** Módulo OCR de facturas de proveedores (Gemini Vision + R2), Financial Advisor IA (anonimizado), Conciliación bancaria, alertas de expiración DIAN, onboarding checklist.
*   **P2 (Semanas 7-10):** Bull queues para emisión asíncrona DIAN (evitar bloqueo de event loop), normalización stock multi-bodega, Throttler distribuido con Redis, R2 storage.
*   **P3 (Semanas 11-12):** Conector de migración Siigo API.

---

## 6. Comandos Clave

| Acción | Frontend (`contex360.fronted`) | Backend (`contex360.backend`) |
| :--- | :--- | :--- |
| **Instalación** | `npm install` | `npm install` |
| **Desarrollo** | `npm run dev` | `npm run dev` / `npm run start:dev` |
| **Compilación** | `npm run build` | `npm run build` |
| **Linter / Tipos** | `npm run lint` / `npx vue-tsc --noEmit` | `npm run lint` |
| **Pruebas** | `npm run test` (Vitest) | `npm run test` (Vitest) |
| **Base de Datos** | N/A | `npx prisma generate` / `npx prisma migrate dev` |
