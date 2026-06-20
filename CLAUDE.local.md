# CLAUDE.local.md — Project Context: next-apollo-pg-ws (PROJECT JACHOEI)

> Local context file for Claude Code. Do not commit secrets. Updated: 2026-06-14.

---

## 1. Project Root

```
/Users/s0mkidd/Desktop/Projects/next-apollo-pg-ws/
```

---

## 2. Directory Structure Overview

```
next-apollo-pg-ws/
├── apps/
│   ├── web/                   # Next.js 14 frontend + GraphQL HTTP API
│   └── ws/                    # Standalone WebSocket/subscription server
├── packages/
│   ├── graphql-core/          # Shared GraphQL typeDefs + resolvers
│   ├── realtime/              # Redis pub/sub (graphql-redis-subscriptions)
│   ├── social-queue/          # Social media posting queue (Facebook, Twitter)
│   └── events/                # Internal event bus
├── db/
│   ├── init.sql               # Initial schema
│   ├── migrations/            # 50+ versioned SQL migrations
│   └── scripts/               # Named schema snapshots
├── storage/                   # Uploaded file storage (bind-mounted)
├── docker-compose.yml         # Base compose config
├── docker-compose.dev.yml     # Dev overrides
├── docker-compose.prod.yml    # Prod overrides
├── .env                       # Active env (symlink or copy of .env.dev)
├── .env.dev
├── .env.prod
└── CLAUDE.local.md
```

---

## 3. Important App/Package Paths

| Path | Purpose |
|------|---------|
| `apps/web/` | Next.js 14 app (frontend + API routes) |
| `apps/web/app/` | Next.js App Router root |
| `apps/web/graphql/` | GraphQL schema & resolvers (web-specific) |
| `apps/web/lib/` | Server-side utilities (db, auth, mailer, storage, apollo) |
| `apps/web/components/` | React UI components |
| `apps/web/store/` | Zustand global state |
| `apps/web/i18n/` | i18n strings (en, th) |
| `apps/ws/src/` | WebSocket server source |
| `packages/graphql-core/src/` | Shared GQL types + resolvers |
| `packages/realtime/src/` | Redis pub/sub singleton |
| `packages/social-queue/` | Social media queue service |
| `packages/events/` | Internal event emitter |

---

## 4. GraphQL-Related Files

| File | Role |
|------|------|
| `apps/web/graphql/typeDefs.ts` | Main GQL type definitions (~22 KB) |
| `apps/web/graphql/resolvers.ts` | Main GQL resolvers (~233 KB) |
| `apps/web/graphql/phoneBlock.ts` | Phone blocking types + resolvers (~35 KB) |
| `apps/web/graphql/contactSpam.ts` | Contact spam types + resolvers (~8 KB) |
| `apps/web/graphql/index.ts` | Schema assembly export |
| `apps/web/app/api/graphql/route.ts` | GraphQL HTTP endpoint (Apollo + graphql-yoga) |
| `apps/web/app/graphql/` | Client-side GQL query/mutation definitions |
| `apps/web/lib/apollo.ts` | Apollo Client setup (HTTP + WS split link) |
| `packages/graphql-core/src/typeDefs.ts` | Shared GQL types (~3 KB) |
| `packages/graphql-core/src/resolvers.ts` | Shared GQL resolvers (~8 KB) |
| `packages/graphql-core/src/blockSync.ts` | Phone block subscription sync |
| `packages/graphql-core/src/bookmarkSync.ts` | Bookmark subscription sync |
| `packages/graphql-core/src/contactSpamSync.ts` | Contact spam subscription sync |
| `packages/realtime/src/pubsub.ts` | Redis pub/sub instance |

---

## 5. Backend/API Entry Points

| File | Description |
|------|-------------|
| `apps/web/app/api/graphql/route.ts` | **Primary API** — GraphQL over HTTP (Apollo Server + graphql-yoga, with file upload support) |
| `apps/ws/src/ws.ts` | **WebSocket server** — GraphQL subscriptions via `graphql-ws`, port 8080 |
| `apps/web/app/api/auth/[...nextauth]/` | NextAuth dynamic route |
| `apps/web/app/api/auth/me/route.ts` | Current user info |
| `apps/web/app/api/auth/logout/route.ts` | Logout |
| `apps/web/app/api/auth/logout-admin/route.ts` | Admin logout |
| `apps/web/app/api/files/route.ts` | File upload/download |
| `apps/web/app/api/geocode/route.ts` | Geocoding |
| `apps/web/app/api/logs/route.ts` | System logs |
| `apps/web/app/api/admin/` | Admin-specific endpoints |
| `apps/web/app/api/dev/` | Dev/debug endpoints |

---

## 6. Database-Related Files

| File | Description |
|------|-------------|
| `apps/web/lib/db.ts` | PostgreSQL client wrapper (pg) |
| `apps/ws/src/db/src/index.ts` | DB utilities for WS server |
| `db/init.sql` | Bootstrap schema (users, posts, chats, messages, files) |
| `db/structure.sql` | Full structure export |
| `db/triggers.sql` | DB triggers |
| `db/helpers.sql` | Helper functions |
| `db/scripts/schema_auth.sql` | Auth-related schema snapshot |
| `db/scripts/schema_core.sql` | Core tables snapshot |
| `db/scripts/schema_full.sql` | Full schema snapshot |
| `db/scripts/schema_scam.sql` | Scam/phone-fraud schema |
| `db/scripts/schema_social.sql` | Social features schema |
| `db/migrations/` | 50+ numbered migration files (see below) |

### Key DB Tables
`users`, `roles`, `files`, `posts`, `chats`, `chat_members`, `messages`, `message_receipts`, `message_images`, `bookmarks`, `comments`, `notifications`, `scam_phones`, `phone_blocks`, `contact_spam`, `contact_spam_settings`, `email_templates`, `email_verify_tokens`, `password_reset_tokens`, `support_tickets`, `device_push_tokens`, `sessions`, `system_logs`

### Migration Naming Convention
```
db/migrations/
  001_normalize_roles_phase1.sql
  1.2__create_sessions.sql
  1.3__message_receipts.sql
  ...
  2.9__system_logs_structured_observability.sql
  3.0__contact_spam_protection.sql
```

---

## 7. Auth-Related Files

| File | Description |
|------|-------------|
| `apps/web/lib/auth/server.ts` | `verifyUserSession`, `verifyAdminSession`, `verifyUserFromRequest` |
| `apps/web/lib/auth/jwt.ts` | JWT sign/verify helpers |
| `apps/web/lib/auth/token.ts` | Token creation & validation |
| `apps/web/lib/auth/options.ts` | NextAuth configuration (providers, callbacks) |
| `apps/web/lib/auth/social.ts` | Google + Facebook OAuth handling |
| `apps/web/app/api/auth/[...nextauth]/` | NextAuth handler |
| `apps/web/app/(auth)/login/` | Login page |
| `apps/web/app/(auth)/register/` | Register page |
| `apps/web/app/(auth)/forgot/` | Forgot password page |
| `apps/web/app/(auth)/reset/` | Password reset page |
| `apps/web/app/(auth)/verify-email/` | Email verification page |
| `apps/web/components/auth/` | Auth UI components (LoginClient, RegisterClient, SocialLogin, GoogleLoginButton, etc.) |
| `db/migrations/1.8__password_reset_tokens.sql` | Password reset schema |
| `db/migrations/1.22__email_verify_tokens.sql` | Email verification schema |
| `db/migrations/1.24__roles.sql` | RBAC roles schema |

**Auth strategy:** NextAuth.js 4.x + custom JWT (httpOnly cookies). Social: Google OAuth, Facebook OAuth. Admin uses a separate cookie (`ADMIN_COOKIE`).

---

## 8. WebSocket / Subscription Files

| File | Description |
|------|-------------|
| `apps/ws/src/ws.ts` | WS server entry — `graphql-ws` `useServer`, JWT from cookie or `Authorization` header |
| `apps/ws/src/shared.ts` | Shared WS types/utilities |
| `apps/ws/src/db/src/index.ts` | DB access for WS server |
| `packages/realtime/src/pubsub.ts` | `RedisPubSub` singleton (ioredis) |
| `packages/graphql-core/src/blockSync.ts` | Pushes phone block events to subscribers |
| `packages/graphql-core/src/bookmarkSync.ts` | Pushes bookmark events |
| `packages/graphql-core/src/contactSpamSync.ts` | Pushes contact-spam events |
| `apps/web/lib/apollo.ts` | Apollo Client — splits HTTP vs WS link based on operation type |

**WS config:** Port `8080`, path `/graphql`. Supports scopes: `web`, `admin`, `android` (android uses `Authorization` header instead of cookie).

---

## 9. Config / Env Files

| File | Description |
|------|-------------|
| `.env` | Active env (dev: symlinked to `.env.dev`) |
| `.env.dev` | Development environment variables |
| `.env.dev.bak` | Backup of dev config |
| `.env.prod` | Production environment variables |
| `.env.prod.bak` | Backup of prod config |
| `apps/web/next.config.js` | Next.js config (webpack aliases, SVG headers, transpile packages) |
| `apps/web/tsconfig.json` | TypeScript config — path aliases: `@/*`, `@core/*`, `@events/*`, `@social/*` |
| `apps/ws/tsconfig.json` | WS server TS config (NodeNext modules, `outDir: dist`) |
| `packages/graphql-core/tsconfig.json` | Shared package TS config |
| `packages/realtime/tsconfig.json` | Realtime package TS config |

### Key Env Variable Groups (names only, no values)
- **DB:** `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- **Redis:** `REDIS_URL`
- **JWT/Session:** `JWT_SECRET`, `COOKIE_SECURE`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- **GraphQL endpoints:** `NEXT_PUBLIC_GRAPHQL_HTTP`, `NEXT_PUBLIC_GRAPHQL_WS`
- **Google OAuth:** `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Facebook OAuth:** `NEXT_PUBLIC_FACEBOOK_APP_ID`, `NEXT_PUBLIC_FACEBOOK_APP_SECRET`
- **Email:** `NEXT_PUBLIC_SENDGRID_API_KEY`, `NEXT_PUBLIC_SENDGRID_FROM_EMAIL`
- **Firebase/FCM:** `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`
- **WS:** `WS_PORT`, `WS_PATH`

---

## 10. Package Manager & Run Scripts

**Package manager:** `npm` (workspaces or per-package `npm ci` via Docker)

### `apps/web/package.json` scripts
```json
"dev"           → next dev (Next.js dev server)
"build"         → next build
"start"         → next start
"worker:social" → node scripts/social-worker.mjs
```

### `apps/ws/package.json` scripts
```json
"dev"   → ts-node-dev src/ws.ts (or tsx watch)
"build" → tsc
"start" → node dist/ws.js
```

### `packages/graphql-core/package.json` scripts
```json
"build" → tsc
```

### `packages/realtime/package.json` scripts
```json
"build" → tsc
```

---

## 11. Docker / Compose Files

| File | Description |
|------|-------------|
| `docker-compose.yml` | Base config — all services |
| `docker-compose.dev.yml` | Dev overrides — hot reload mounts, exposed ports (3000, 8080, 8081, 443) |
| `docker-compose.prod.yml` | Prod overrides — image builds, health checks, restart policies |

### Docker Services
| Service | Image / Build | Purpose |
|---------|--------------|---------|
| `postgres` | postgres:16-alpine | Primary database |
| `redis` | redis:7-alpine | Pub/sub + queue |
| `web` | apps/web | Next.js app |
| `ws` | apps/ws | WebSocket server |
| `caddy` | caddy:2-alpine | Reverse proxy (HTTPS) |
| `pgadmin` | pgadmin4 | DB admin UI |
| `social-worker` | apps/web | `worker:social` script |

---

## 12. Migration / Schema / Seed Files

```
db/
├── init.sql                                    ← run once on fresh DB
├── structure.sql                               ← full current structure export
├── triggers.sql
├── helpers.sql
├── scripts/
│   ├── schema_auth.sql
│   ├── schema_core.sql
│   ├── schema_full.sql
│   ├── schema_scam.sql
│   └── schema_social.sql
└── migrations/
    ├── 001_normalize_roles_phase1.sql
    ├── 002_normalize_roles_phase3_cleanup.sql
    ├── 1.2__create_sessions.sql
    ├── 1.3__message_receipts.sql
    ├── 1.4__views_and_helpers.sql
    ├── 1.5__messages_soft_delete.sql
    ├── 1.6__files.sql
    ├── 1.7__system_logs.sql
    ├── 1.8__password_reset_tokens.sql
    ├── 1.9__post_images.sql
    ├── 1.10__bookmarks.sql
    ├── 1.16__notifications.sql
    ├── 1.17__comments.sql
    ├── 1.18__message_images.sql
    ├── 1.19__messages-reply_to_id.sql
    ├── 1.20__scam_phones_summary.sql
    ├── 1.21__email_templates.sql
    ├── 1.22__email_verify_tokens.sql
    ├── 1.23__support_tickets.sql
    ├── 1.24__roles.sql
    ├── 1.25__social_posts.sql
    ├── 2.1__device_push_tokens.sql
    ├── 2.6__messages_audio.sql
    ├── 2.7__messages_location.sql
    ├── 2.8__call_block_spam_system.sql
    ├── 2.9__system_logs_structured_observability.sql
    └── 3.0__contact_spam_protection.sql
```

No ORM migration runner detected — migrations appear to be applied manually via `psql` or Docker entrypoint.

---

## 13. Frontend App Routes / Components

### Route Groups (Next.js App Router)
```
apps/web/app/
├── layout.tsx                    ← Root layout (providers, antd theme)
├── (auth)/                       ← Unauthenticated layout
│   ├── login/page.tsx
│   ├── register/page.tsx
│   ├── forgot/page.tsx
│   ├── reset/page.tsx
│   └── verify-email/page.tsx
├── (main)/                       ← Authenticated app layout
│   ├── page.tsx                  ← Home/Feed
│   ├── chat/
│   ├── notification/
│   ├── post/
│   ├── profile/
│   ├── search/
│   ├── settings/
│   ├── my/
│   ├── blocked/
│   ├── donate/
│   ├── help/
│   ├── support/
│   ├── license/
│   ├── open-source/
│   ├── privacy/
│   ├── terms/
│   ├── pdpa/
│   └── roadmap/
├── (admin)/
│   └── admin/page.tsx
└── phone/
    ├── block/
    ├── list/
    ├── lookup/
    └── report/
```

### Key Component Directories
```
apps/web/components/
├── auth/          ← Login, Register, Social login, etc.
├── chat/          ← Chat UI
├── comments/      ← Comment threads
├── footer/
├── jachoei/       ← Domain-specific components
└── post/          ← Post creation/display
```

### State Management
- `apps/web/store/` — Zustand stores
- `apps/web/app/providers/` — React context providers
- `apps/web/app/hooks/` — Custom React hooks

---

## 14. Project Organization Notes

- **Monorepo** with `apps/` (runnable services) and `packages/` (shared libs). No root-level `package.json` workspace config — each app installs independently; packages are referenced via TypeScript path aliases and webpack aliases.
- **GraphQL is the primary API surface.** All mutations/queries go through `app/api/graphql/route.ts`. Real-time data goes through the `ws` service.
- **Auth is layered:** NextAuth handles session + social login. A separate JWT in httpOnly cookie (`USER_COOKIE`) is verified server-side for GraphQL context. Admin uses a separate `ADMIN_COOKIE`.
- **Database access is raw SQL via `pg`.** No ORM. All queries are in `apps/web/lib/db.ts` helpers and inline in resolvers.
- **Redis** is used for both pub/sub (GraphQL subscriptions via `graphql-redis-subscriptions`) and job queuing (social-queue).
- **Internationalization** covers English and Thai (`apps/web/i18n/en.ts`, `th.ts`).
- **File uploads** use `graphql-upload-minimal` through the GraphQL endpoint and are stored in `storage/`.
- **Caddy** handles TLS termination and reverse-proxies to `web` (port 3000) and `ws` (port 8080).
- The `social-worker` service runs as a separate process (`scripts/social-worker.mjs`) consuming from the social-queue.

---

## 15. Common Commands

### Development (Docker)
```bash
# Start all services in dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Rebuild a specific service
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build web

# Stop all services
docker compose down
```

### Development (Local — web app)
```bash
cd apps/web
npm install
npm run dev              # Next.js dev server (port 3000)
npm run worker:social    # Social media queue worker
```

### Development (Local — WS server)
```bash
cd apps/ws
npm install
npm run dev              # ts-node-dev watch mode
npm run build            # Compile TypeScript → dist/
npm run start            # Run compiled dist/ws.js
```

### Build shared packages
```bash
cd packages/graphql-core && npm run build
cd packages/realtime && npm run build
```

### Database
```bash
# Connect to running postgres container
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB

# Apply a migration manually
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /path/to/migration.sql

# Dump database
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
```

### Production
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Lint / Type-check
```bash
# In apps/web (if configured)
npx tsc --noEmit          # Type check
npx next lint             # ESLint via Next.js
```

> **Note:** No `test` script was found in any `package.json`. Testing setup is not configured.
