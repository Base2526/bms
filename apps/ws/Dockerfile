FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) คัดลอก package.json root (เผื่อใช้ dependency บางตัวร่วมกัน)
COPY package*.json ./

# 2) คัดลอกโค้ด apps/ws + packages ที่เกี่ยวข้อง
COPY apps ./apps
COPY packages ./packages

# 3) ติดตั้ง dependencies เฉพาะของ ws และ shared packages
RUN npm --prefix ./apps/ws ci \
 && npm --prefix ./packages/realtime ci \
 && npm --prefix ./packages/graphql-core ci

WORKDIR /app/apps/ws

ENV NODE_ENV=production

EXPOSE 8080

# 4) รันด้วย tsx ตรง ๆ (ตาม script ใน package.json)
CMD ["npm", "run", "start"]
