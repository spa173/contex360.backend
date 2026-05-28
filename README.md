---
title: Contex360 Backend Staging
emoji: 🚀
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Contex360 Backend

The backend REST API for the Contex360 ERP system. Built with NestJS and Prisma.

## 🚀 Technologies

- **Framework**: NestJS (Node.js)
- **Database**: PostgreSQL (Neon)
- **ORM**: Prisma
- **Authentication**: JWT, Google OAuth, TOTP 2FA
- **Testing**: Vitest / Jest

## ✨ Key Features (Recently Implemented)

- **📧 Transactional Emails (`notification.service.ts`)**: Structured HTML templates in Spanish for core client touchpoints (Onboarding, Payment Confirmation, Renewal Reminder, Payment Failed, Subscription Expired).
- **📈 Churn Detection (`churn-detection.service.ts`)**: Weekly automated cron checks to detect inactive tenants (>30 days), track upcoming renewals, and compute analytics.
- **💱 Currency Service (`currency.service.ts`)**: Dynamic multi-currency rate support (COP, USD, EUR, MXN) with conversion and formatting capabilities.
- **🔑 API Keys System (`api-keys.service.ts`)**: Full CRUD support for tenant developer API Keys guarded under the `X-API-Key` header with automatic expiration options.
- **🪝 Webhooks Infrastructure (`webhook.service.ts`)**: CRUD endpoints for subscription events, payloads dispatched with HMAC cryptographic signatures, retry queue with exponential backoff (5 attempts), and daily re-run scheduler.
- **🛡️ 2FA Enterprise Enforcement**: Automatic guard checking that locks down Enterprise tier actions if the user hasn't configured TOTP 2FA.
- **🚦 Per-Tenant Rate Limiting**: Limit of 100 requests per minute per tenant with automatic periodic memory cleanup.
- **🩺 Sentry Logging integration**: Capture and report fatal errors/exceptions dynamically via `@sentry/node` if `SENTRY_DSN` is configured.

## 📦 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- PostgreSQL database

### Installation

```bash
npm install
```

### Database Setup

```bash
# Apply migrations to database
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

### Development

```bash
# Development mode
npm run start:dev
```

### Running Tests

```bash
npm test
```

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure your credentials. Do **NOT** commit your `.env` file to version control.

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: Secret key for signing JWTs.
- `GOOGLE_CLIENT_ID` / `SECRET`: For OAuth integration.

---

## ⏳ Pendiente: Firma Electrónica DIAN

La integración base y las variables de entorno de facturación electrónica DIAN para el cobro del SaaS ya están configuradas en el archivo `.env`. Para habilitar la firma digital en producción o pruebas, queda **pendiente** configurar las siguientes credenciales una vez obtenidas de la entidad certificadora (ej. GSE o Certicámara):

1. **`SAAS_DIAN_CERTIFICATE`**: Tu archivo de certificado de firma digital (`.p12` o `.pfx`) codificado en cadena **Base64**.
2. **`SAAS_DIAN_CERTIFICATE_PASSWORD`**: La contraseña del certificado digital configurado.

Para codificar tu certificado en Windows (PowerShell):
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\ruta\a\tu\certificado.p12"))
```

---

## 🚢 Deployment

This project is configured for deployment via Hugging Face Spaces (Docker).
