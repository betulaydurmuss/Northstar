# One image definition, three targets: api, worker and web. Build them with
#   docker compose -f docker-compose.prod.yml build

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Prisma's query engine links against OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Manifests first, so dependency layers are cached until a package.json changes.
# The root postinstall compiles shared/, which extends the base tsconfig.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY worker/package.json worker/
COPY web/package.json web/
COPY api/prisma api/prisma
COPY shared shared
RUN npm ci
COPY . .
# Baked into the web bundle: the host names that serve the dashboard. Anything else is
# treated as a client's status page domain, so this must name the production host.
ARG VITE_APP_HOSTS=localhost
ENV VITE_APP_HOSTS=$VITE_APP_HOSTS
RUN npm run build

# The api: Express, plus the migrations it applies before starting.
FROM node:24-bookworm-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production STORAGE_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/api/package.json api/
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/prisma api/prisma
# Logos and reports are written here by the unprivileged user.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema api/prisma/schema.prisma && node api/dist/server.js"]

# The worker: checks, alerts, rollups and reports. Chromium renders the PDF reports.
FROM node:24-bookworm-slim AS worker
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl chromium fonts-inter fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production STORAGE_DIR=/data CHROME_PATH=/usr/bin/chromium
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/worker/package.json worker/
COPY --from=build /app/worker/dist worker/dist
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "worker/dist/index.js"]

# The web app is static files; Caddy serves them and forwards /api to the api.
FROM caddy:2.8-alpine AS web
COPY --from=build /app/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
