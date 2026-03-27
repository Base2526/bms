# --- Builder stage ---
FROM node:20-bookworm-slim AS builder

# เตรียมเครื่องมือ build เผื่อ sharp ต้อง compile
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# เอา packages เข้ามาก่อน เพื่อให้ path ../../packages/... ใช้ได้
COPY packages ./packages

# เข้าโฟลเดอร์เว็บแอป
WORKDIR /app/apps/web

# คัดลอกไฟล์ที่ใช้ติดตั้ง deps ก่อน (ให้ cache ดีขึ้น)
COPY apps/web/package*.json ./

# ====== รับค่า env จาก build args (มาจาก docker-compose.prod.yml) ======
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_GRAPHQL_HTTP
ARG NEXT_PUBLIC_GRAPHQL_WS
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ARG NEXT_PUBLIC_FACEBOOK_APP_ID
ARG NEXT_PUBLIC_FACEBOOK_APP_SECRET
ARG NEXT_PUBLIC_SENDGRID_API_KEY
ARG NEXT_PUBLIC_SENDGRID_FROM_EMAIL
ARG NEXT_PUBLIC_SUPPORT_URL
ARG NEXT_PUBLIC_SUPPORT_TO_EMAIL

ARG COOKIE_SECURE
ARG WEB_NAME

ARG FB_PAGE_ID
ARG FB_PAGE_ACCESS_TOKEN
ARG SOCIAL_QUEUE_KEY
ARG SOCIAL_DLQ_KEY
ARG SOCIAL_DELAYED_KEY
ARG ADMIN_TOKEN
ARG JWT_SECRET

ARG DEBUG_LOG
ARG DB_LOG
ARG DB_LOG_LEVELS

ARG FCM_PROJECT_ID
ARG FCM_CLIENT_EMAIL
ARG FCM_PRIVATE_KEY

# expose ให้ next build เห็น (process.env.* ตอน build time)
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV NEXT_PUBLIC_GRAPHQL_HTTP=$NEXT_PUBLIC_GRAPHQL_HTTP
ENV NEXT_PUBLIC_GRAPHQL_WS=$NEXT_PUBLIC_GRAPHQL_WS
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_PUBLIC_FACEBOOK_APP_ID=$NEXT_PUBLIC_FACEBOOK_APP_ID
ENV NEXT_PUBLIC_FACEBOOK_APP_SECRET=$NEXT_PUBLIC_FACEBOOK_APP_SECRET
ENV NEXT_PUBLIC_SENDGRID_API_KEY=$NEXT_PUBLIC_SENDGRID_API_KEY
ENV NEXT_PUBLIC_SENDGRID_FROM_EMAIL=$NEXT_PUBLIC_SENDGRID_FROM_EMAIL
ENV NEXT_PUBLIC_SUPPORT_URL=$NEXT_PUBLIC_SUPPORT_URL
ENV NEXT_PUBLIC_SUPPORT_TO_EMAIL=$NEXT_PUBLIC_SUPPORT_TO_EMAIL

ENV COOKIE_SECURE=$COOKIE_SECURE
ENV WEB_NAME=$WEB_NAME

ENV FB_PAGE_ID=$FB_PAGE_ID
ENV FB_PAGE_ACCESS_TOKEN=$FB_PAGE_ACCESS_TOKEN
ENV SOCIAL_QUEUE_KEY=$SOCIAL_QUEUE_KEY
ENV SOCIAL_DLQ_KEY=$SOCIAL_DLQ_KEY
ENV SOCIAL_DELAYED_KEY=$SOCIAL_DELAYED_KEY
ENV ADMIN_TOKEN=$ADMIN_TOKEN
ENV JWT_SECRET=$JWT_SECRET
ENV DEBUG_LOG=$DEBUG_LOG
ENV DB_LOG=$DB_LOG
ENV DB_LOG_LEVELS=$DB_LOG_LEVELS

ENV FCM_PROJECT_ID=$FCM_PROJECT_ID
ENV FCM_CLIENT_EMAIL=$FCM_CLIENT_EMAIL
ENV FCM_PRIVATE_KEY=$FCM_PRIVATE_KEY

# ติดตั้ง dependencies ของเว็บ + optional (ให้ดึง sharp มาด้วย)
RUN npm ci --include=optional

# บังคับให้ sharp ติดตั้ง binary สำหรับ linux-arm64 โดยตรง (เผื่อจำเป็น)
RUN npm install --os=linux --cpu=arm64 sharp --force --ignore-scripts=false || true

# รีบิวด์ sharp ให้ตรงกับ runtime ปัจจุบันอีกรอบ
RUN npm rebuild sharp --force || true

# คัดลอกโค้ดเว็บทั้งหมด (รวม next.config.mjs, tsconfig, src ฯลฯ)
COPY apps/web ./

# build Next.js (ใช้ next.config.mjs + alias @core)
RUN npm run build

# --- Runner stage ---
FROM node:20-bookworm-slim AS runner

WORKDIR /app/apps/web

ENV NODE_ENV=production

# โค้ดเว็บที่ build แล้ว (รวม .next, public, next.config.mjs ฯลฯ)
COPY --from=builder /app/apps/web ./
# packages สำหรับ alias @core -> ../../packages/graphql-core/src
COPY --from=builder /app/packages /app/packages
# node_modules ของเว็บ
COPY --from=builder /app/apps/web/node_modules ./node_modules

EXPOSE 3000

CMD ["npm", "run", "start"]