FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so source edits keep the dependency layers cached.
COPY apps/ws/package*.json ./apps/ws/
COPY packages/realtime/package*.json ./packages/realtime/
COPY packages/graphql-core/package*.json ./packages/graphql-core/

RUN npm --prefix ./apps/ws ci \
 && npm --prefix ./packages/realtime ci \
 && npm --prefix ./packages/graphql-core ci

# The gateway only imports these three source trees. Keeping the build context
# narrow avoids transferring the web/mobile workspaces and local artifacts.
COPY apps/ws ./apps/ws
COPY packages/realtime ./packages/realtime
COPY packages/graphql-core ./packages/graphql-core

WORKDIR /app/apps/ws

ENV NODE_ENV=production

EXPOSE 8080

CMD ["npm", "run", "start"]
