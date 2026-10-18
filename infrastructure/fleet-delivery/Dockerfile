FROM node:22.12-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.fleet-delivery.json tsup.fleet-delivery.config.ts ./
COPY apps/fleet-delivery-api/package.json apps/fleet-delivery-api/package.json
COPY apps/fleet-delivery-worker/package.json apps/fleet-delivery-worker/package.json
COPY packages/fleet-delivery-contracts/package.json packages/fleet-delivery-contracts/package.json
COPY packages/fleet-delivery-domain/package.json packages/fleet-delivery-domain/package.json
COPY packages/fleet-delivery-database/package.json packages/fleet-delivery-database/package.json
COPY packages/fleet-delivery-shared/package.json packages/fleet-delivery-shared/package.json
RUN npm ci
COPY apps/fleet-delivery-api apps/fleet-delivery-api
COPY apps/fleet-delivery-worker apps/fleet-delivery-worker
COPY packages/fleet-delivery-contracts packages/fleet-delivery-contracts
COPY packages/fleet-delivery-domain packages/fleet-delivery-domain
COPY packages/fleet-delivery-database packages/fleet-delivery-database
COPY packages/fleet-delivery-shared packages/fleet-delivery-shared
RUN npm run build

FROM node:22.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/fleet-delivery-api/package.json apps/fleet-delivery-api/package.json
COPY apps/fleet-delivery-worker/package.json apps/fleet-delivery-worker/package.json
COPY packages/fleet-delivery-contracts/package.json packages/fleet-delivery-contracts/package.json
COPY packages/fleet-delivery-domain/package.json packages/fleet-delivery-domain/package.json
COPY packages/fleet-delivery-database/package.json packages/fleet-delivery-database/package.json
COPY packages/fleet-delivery-shared/package.json packages/fleet-delivery-shared/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /workspace/dist ./dist
COPY packages/fleet-delivery-database/migrations ./migrations
USER node

FROM runtime AS api
EXPOSE 4100
CMD ["node", "dist/fleet-delivery-api/main.js"]

FROM runtime AS worker
CMD ["node", "dist/fleet-delivery-worker/main.js"]
