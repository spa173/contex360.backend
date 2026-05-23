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
- **Testing**: Jest

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
# Push schema to database
npx prisma db push

# Generate Prisma client
npx prisma generate
```

### Development

```bash
# Development mode
npm run start:dev
```

### Building for Production

```bash
npm run build
npm run start:prod
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

## 🚢 Deployment

This project is configured for deployment via Hugging Face Spaces (Docker).
