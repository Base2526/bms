# --- Builder stage ---
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY packages ./packages

WORKDIR /app/apps/web

COPY apps/web/package*.json ./

ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_GRAPHQL_HTTP
ARG NEXT_PUBLIC_GRAPHQL_WS
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ARG NEXT_PUBLIC_FACEBOOK_APP_ID
ARG NEXT_PUBLIC_SUPPORT_URL
ARG NEXT_PUBLIC_SUPPORT_TO_EMAIL

ARG COOKIE_SECURE
ARG WEB_NAME

ARG DEBUG_LOG
ARG DB_LOG
ARG DB_LOG_LEVELS

ARG TARGETARCH
ARG NEXT_BUILD_CPUS=2
ARG NODE_BUILD_MAX_OLD_SPACE_SIZE=4096

ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_GRAPHQL_HTTP=$NEXT_PUBLIC_GRAPHQL_HTTP
ENV NEXT_PUBLIC_GRAPHQL_WS=$NEXT_PUBLIC_GRAPHQL_WS
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_PUBLIC_FACEBOOK_APP_ID=$NEXT_PUBLIC_FACEBOOK_APP_ID
ENV NEXT_PUBLIC_SUPPORT_URL=$NEXT_PUBLIC_SUPPORT_URL
ENV NEXT_PUBLIC_SUPPORT_TO_EMAIL=$NEXT_PUBLIC_SUPPORT_TO_EMAIL

ENV COOKIE_SECURE=$COOKIE_SECURE
ENV WEB_NAME=$WEB_NAME

ENV DEBUG_LOG=$DEBUG_LOG
ENV DB_LOG=$DB_LOG
ENV DB_LOG_LEVELS=$DB_LOG_LEVELS

RUN npm ci --include=optional

RUN cd /app/packages/realtime && npm ci --omit=dev

RUN case "$TARGETARCH" in \
      arm64) sharp_cpu=arm64 ;; \
      amd64) sharp_cpu=x64 ;; \
      *) echo "Unsupported Docker target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && npm install --os=linux --cpu="$sharp_cpu" sharp --force --ignore-scripts=false
RUN npm rebuild sharp --force || true

COPY apps/web ./

# Build concurrency and V8 heap are build-host policy, not runtime settings. Production hosts that
# cannot consume prebuilt images can lower both without editing a tracked Dockerfile.
ENV NEXT_BUILD_CPUS=$NEXT_BUILD_CPUS
ENV NODE_OPTIONS=--max-old-space-size=$NODE_BUILD_MAX_OLD_SPACE_SIZE
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- Runner stage ---
FROM node:20-bookworm-slim AS runner

WORKDIR /app/apps/web

ENV NODE_ENV=production

COPY --from=builder /app/apps/web ./
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/apps/web/node_modules ./node_modules
COPY db /app/db

EXPOSE 3000

CMD ["npm", "run", "start"]
