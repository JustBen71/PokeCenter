FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @pokerace/shared && npm run build -w @pokerace/web
FROM caddy:2.10.2-alpine
COPY --from=build /app/apps/web/dist /srv
