# Stage 1: Build the NestJS application
FROM node:20-slim AS builder

# Install openssl for Prisma compatibility during build
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

# Stage 2: Production environment
FROM node:20-slim AS runner

# Install openssl for Prisma client runtime compatibility
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

# Only install production dependencies
RUN npm install --omit=dev

# Copy generated Prisma client from builder stage
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

USER node

CMD ["node", "--max-old-space-size=384", "dist/main.js"]
