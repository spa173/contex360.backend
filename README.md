# Contex360 Backend

Backend inicial para Contex360 construido con NestJS.

## Incluye

- API base con `GET /`
- health check en `GET /health`
- autenticacion con `POST /auth/login`, `GET /auth/me` y `POST /auth/logout`
- Swagger en `/docs`
- configuracion por `.env`
- Prisma listo para PostgreSQL

## Arranque

```bash
npm install
npm run db:setup
npm run db:migrate
npm run start:dev
```

## Variables de entorno

Copiar `.env.example` como `.env` antes de arrancar.

## Prisma

```bash
npm run prisma:generate
npm run prisma:studio
# Recreate the local database and seed data from scratch.
npm run db:reset
```

### Datos semilla

- `admin@contex360.local` / `admin@contex360.local!A1`
- `contador@contex360.local` / `contador@contex360.local!A1`
- `visor@contex360.local` / `visor@contex360.local!A1`
- `retail.admin@contex360.local` / `retail.admin@contex360.local!A1`
- `nomina@contex360.local` / `nomina@contex360.local!A1`

## Base de datos local

El script `npm run db:setup` crea un cluster PostgreSQL de desarrollo en `backend/.pgdata` y levanta una base local en el puerto `5433`.
Luego `npm run db:migrate` aplica el schema de Prisma sobre esa base.
Si quieres apagar el cluster local, usa `npm run db:stop`.
