# CLAUDE.md - Contex360 Backend

## 🤖 Directrices del Agente (Claude Code & Antigravity)

Para cualquier tarea de desarrollo, refactorización, base de datos, depuración o commit, debes leer y cumplir estrictamente las reglas locales ubicadas en el directorio `.claude/`:
*   **Reglas Backend, NestJS, Prisma y Rendimiento:** Lee y aplica obligatoriamente [.claude/backend-rules.md](file:///c:/Users/camilo/Desktop/contex360.backend/.claude/backend-rules.md) y [.claude/backend-product-rules.md](file:///c:/Users/camilo/Desktop/contex360.backend/.claude/backend-product-rules.md) (para lógica del catálogo y productos) para todos los desarrollos de API, DTOs, rate limiting, validaciones, logs, testing y queries de base de datos.
*   **Seguridad, Exclusiones y Git:** Lee y aplica obligatoriamente [.claude/git-security-rules.md](file:///c:/Users/camilo/Desktop/contex360.backend/.claude/git-security-rules.md) para políticas de ignorado, protección de secretos y tokens, y validaciones previas a commits/push.

---

## 📝 Descripción del Proyecto
**Contex360** es un sistema ERP inteligente diseñado a medida para empresas en Colombia. Ofrece una plataforma integral SaaS multi-inquilino (multi-tenant) con los siguientes módulos de negocio:
*   **Facturación Electrónica DIAN:** Integración para firmas de facturas electrónicas y cobros bajo la normativa colombiana.
*   **Inventario y Productos:** Gestión del catálogo de productos, control de stock y almacén.
*   **Ventas, Compras y Cotizaciones:** Procesamiento de compras, generación de facturas y cotizaciones.
*   **Terceros:** Directorio unificado de clientes, proveedores y contactos comerciales.
*   **Finanzas y Contabilidad:** Módulo de tesorería y libros contables (ledger).
*   **Asistente de IA:** Integraciones inteligentes basadas en modelos de IA generativa (Gemini/Groq).

El **Backend** es una API REST robusta construida con NestJS y Prisma, que maneja la lógica de negocio, autenticación avanzada (2FA TOTP), control de suscripciones y cuotas de uso (Tenants), almacenamiento de base de datos relacional y tareas automatizadas en segundo plano (cron jobs).

---

## 🛠️ Tech Stack
*   **Framework:** NestJS (Node.js >= 20.0.0, CommonJS)
*   **Build/Dev Tool:** Vite (a través de `vite-plugin-node` para dev rápido con NestJS y SWC)
*   **Base de Datos:** PostgreSQL (Neon en staging/producción)
*   **ORM:** Prisma
*   **Testing:** Vitest / Jest (Vitest configurado en `vitest.config.ts`)
*   **Linter/Logger:** NestJS Pino Logger, Pino
*   **Despliegue:** Hugging Face Spaces (Docker)

---

## 🚀 Comandos Clave
### Desarrollo y Build
*   **Instalación:** `npm install`
*   **Desarrollo (Vite/Hot Reload):** `npm run dev` o `npm run start:dev`
*   **Compilación (Build):** `npm run build`
*   **Iniciar Producción:** `npm run start` o `npm run start:prod` (corre `dist/main.js` con límite de memoria)

### Base de Datos & Prisma
*   **Generar Cliente Prisma:** `npm run prisma:generate` o `npx prisma generate`
*   **Formatear Esquema Prisma:** `npm run prisma:format`
*   **Aplicar Migraciones (Dev):** `npm run db:migrate` (crea y aplica migraciones locales)
*   **Resetear Base de Datos:** `npm run db:reset`
*   **Ejecutar Semillas (Seeds):** `npm run db:seed`
*   **Ver Panel (Prisma Studio):** `npm run prisma:studio`
*   **Configurar DB Local (Scripts):** `npm run db:setup` / `npm run db:stop`

### Testing
*   **Ejecutar Tests:** `npm run test` (Vitest una pasada)
*   **Modo Watch:** `npm run test:watch`
*   **Cobertura:** `npm run test:coverage`

---

## 📁 Estructura del Proyecto
*   `src/`: Código fuente de NestJS.
    *   `src/main.ts`: Punto de entrada de la aplicación.
    *   Módulos, controladores y servicios organizados por dominio.
*   `prisma/`: Archivos de base de datos.
    *   `prisma/schema.prisma`: Esquema de base de datos de Prisma.
    *   `prisma/seed.ts`: Script de inicialización de datos base.
*   `scripts/`: Scripts auxiliares de base de datos y utilidades de entorno.
