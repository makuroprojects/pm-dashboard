FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Generate Prisma client
FROM deps AS prisma
COPY prisma ./prisma
RUN bunx prisma generate

# Build frontend (Vite → dist/)
FROM prisma AS builder
COPY . .
RUN bun run build

# Runtime
FROM base AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/index.tsx"]