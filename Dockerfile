# PYB — Next.js 15 standalone build for Dokploy.
# Build:  docker build -t pyb .
# Run:    docker run -e DATABASE_URL=... -e CONGRESS_API_KEY=... -p 3000:3000 pyb

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next build needs no secrets at build time (env read at runtime).
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S pyb && adduser -S pyb -G pyb
COPY --from=build --chown=pyb:pyb /app/.next/standalone ./
COPY --from=build --chown=pyb:pyb /app/.next/static ./public/../.next/static
COPY --from=build --chown=pyb:pyb /app/public ./public
USER pyb
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
