import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

const gateway = readFileSync(new URL("../apps/ws/src/ws.ts", import.meta.url), "utf8");
const security = readFileSync(new URL("../apps/ws/src/security.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../apps/ws/Dockerfile", import.meta.url), "utf8");
const ticketRoute = readFileSync(new URL("../apps/web/app/api/bms/realtime/ticket/route.ts", import.meta.url), "utf8");
const realtimeAuth = readFileSync(new URL("../apps/web/lib/bms/realtimeAuth.ts", import.meta.url), "utf8");
const caddyServer = readFileSync(new URL("../apps/web/Caddyfile.server", import.meta.url), "utf8");
const caddyLocal = readFileSync(new URL("../apps/web/Caddyfile.local", import.meta.url), "utf8");
const composeFiles = ["docker-compose.yml", "docker-compose.dev.yml", "docker-compose.prod.yml"]
  .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const composeProd = readFileSync(new URL("../docker-compose.prod.yml", import.meta.url), "utf8");
const composeDev = readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8");
const pubsub = readFileSync(new URL("../packages/realtime/src/pubsub.ts", import.meta.url), "utf8");
const browserClient = readFileSync(new URL("../apps/web/lib/apollo.ts", import.meta.url), "utf8");
const webResolvers = readFileSync(new URL("../apps/web/graphql/resolvers.ts", import.meta.url), "utf8");

test("gateway accepts subscription operations only, and production disables nothing that still has users", () => {
  assert.match(security, /operation\.operation !== "subscription"/);
  assert.match(gateway, /inspectSubscriptionOperation/);

  // ลิสต์นี้คือฟีเจอร์ที่หายไปจาก production — `time` เป็นตัวจับเวลาสำหรับดีบั๊กที่ไม่มีจอไหนใช้
  // ส่วนแชท/คอมเมนต์ถูกเปิดกลับหลังแก้ตัวกรองแล้ว · ใส่ชื่อกลับเข้าไปโดยไม่มีเหตุผลใหม่ =
  // จอที่ไม่อัปเดตเองโดยไม่มี error ที่ไหนบอกว่าทำไม
  const disabled = /PRODUCTION_DISABLED_SUBSCRIPTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(security);
  assert.ok(disabled, "หา PRODUCTION_DISABLED_SUBSCRIPTIONS ไม่เจอ");
  const names = [...disabled![1].matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, ["time"], `ปิด subscription เพิ่มโดยไม่มีเหตุผลใหม่: ${names.join(", ")}`);
});

test("every chat and comment subscription that production serves identifies its subscriber", () => {
  // ตอนที่ทั้งห้าตัวยังถูกปิด มันไม่ตรวจอะไรเลย (`messageAdded`/`messageDeleted` ไม่เรียก
  // `requireRealtimeUserId` ด้วยซ้ำ · `commentDeleted` คืน true เสมอ) · เปิดกลับได้เพราะแก้แล้ว
  // เท่านั้น ด่านนี้จึงตรึงว่า "เปิดอยู่" กับ "ตรวจแล้ว" ต้องมาคู่กันเสมอ
  for (const field of ["messageAdded", "messageDeleted", "commentAdded", "commentUpdated", "commentDeleted"]) {
    const scoped = new RegExp(`^ {4}${field}: \\{([\\s\\S]*?)^ {4}\\},$`, "m").exec(core);
    assert.ok(scoped, `หา resolver ของ ${field} ไม่เจอ`);
    assert.match(
      scoped![1],
      /requireRealtimeUserId\(ctx\)/,
      `${field} ถูกเสิร์ฟบน production แต่ไม่ได้ระบุตัวผู้รับ`,
    );
  }
  // ผู้รับของข้อความมาจาก routing data ที่ publisher แนบมา ไม่ใช่จาก id ที่ client พิมพ์
  assert.match(core, /messageAddedAudience/);
  assert.match(core, /messageDeletedAudience/);
  assert.match(webResolvers, /messageAddedAudience: targetUserIds/);
});

test("query and variables byte limits are enforced before execution", () => {
  assert.match(security, /QUERY_TOO_LARGE/);
  assert.match(security, /VARIABLES_TOO_LARGE/);
  assert.match(gateway, /WS_MAX_MESSAGE_BYTES/);
});

test("browser origins use an exact normalized allowlist", () => {
  assert.match(security, /new URL\(origin\)\.origin/);
  assert.match(security, /WS_ALLOWED_ORIGINS is required in production/);
  assert.match(gateway, /verifyClient/);
  assert.match(gateway, /x-bms-client-class/);
});

test("fleet connection leases cover ip, user, and tenant", () => {
  assert.match(security, /bms:rt:conn:ip:/);
  assert.match(security, /bms:rt:conn:user:/);
  assert.match(security, /bms:rt:conn:tenant:/);
  assert.match(gateway, /acquireRealtimeConnectionLease/);
});

test("BMS Inbox has no default tenant fallback and requires ticket permission", () => {
  assert.doesNotMatch(core, /DEFAULT_BMS_TENANT_ID/);
  assert.match(core, /claims\.permissions\.includes\("inbox\.view"\)/);
  assert.match(core, /claims\.tenantId/);
});

test("HTTP mints admin tickets only after strict revocation, fresh identity, acting tenant, permissions and locations", () => {
  assert.match(ticketRoute, /mintAdminRealtimeTicket/);
  assert.match(realtimeAuth, /isAdminSessionActiveForRealtime/);
  assert.match(realtimeAuth, /refreshAdminIdentity/);
  assert.match(realtimeAuth, /actingTenantId/);
  assert.match(realtimeAuth, /loadPermissions/);
  assert.match(realtimeAuth, /bms_user_allowed_locations/);
  assert.doesNotMatch(realtimeAuth, /DEFAULT_TENANT/);
});

test("gateway uses ticket auth, ongoing revocation, expiry, health and drain without database access", () => {
  assert.match(gateway, /verifyRealtimeTicket/);
  assert.match(gateway, /session:admin:/);
  assert.match(gateway, /ticket expired/);
  assert.match(gateway, /\/healthz/);
  assert.match(gateway, /\/readyz/);
  assert.match(gateway, /SIGTERM/);
  assert.doesNotMatch(gateway, /from ["'][^"']*(?:lib\/db|\bpg\b)/);
});

test("WS image never bakes JWT_SECRET into an ARG or ENV layer", () => {
  assert.doesNotMatch(dockerfile, /ARG JWT_SECRET/);
  assert.doesNotMatch(dockerfile, /ENV JWT_SECRET/);
});

test("every compose file injects the web ticket TTL and WS gateway controls", () => {
  for (const compose of composeFiles) {
    for (const key of [
      "WS_TICKET_TTL_SECONDS", "WS_ALLOWED_ORIGINS", "WS_MAX_CONNECTIONS_PER_IP",
      "WS_MAX_CONNECTIONS_PER_USER", "WS_MAX_CONNECTIONS_PER_TENANT",
      "WS_MAX_SUBSCRIPTIONS_PER_CONNECTION", "WS_CONNECTION_INIT_TIMEOUT_MS",
      "WS_IDLE_TIMEOUT_MS", "WS_MAX_MESSAGE_BYTES",
      // ไม่ส่งตัวนี้เข้าไป = ws เห็นทุก connection หลัง reverse proxy เป็น IP เดียว แล้ว
      // WS_MAX_CONNECTIONS_PER_IP กลายเป็นเพดานรวมของทั้งแพลตฟอร์มแทนที่จะเป็นต่อผู้ใช้
      "WS_TRUST_PROXY", "REALTIME_REDIS_COMMAND_TIMEOUT_MS",
      "REALTIME_SUBSCRIPTIONS_ENABLED", "REALTIME_ORDERS_ENABLED",
      "REALTIME_RESTAURANT_ENABLED", "REALTIME_INVENTORY_ENABLED",
      "REALTIME_PAYMENTS_ENABLED",
    ]) assert.match(compose, new RegExp(`${key}:`), `${key} missing from a compose file`);
  }
});

test("Caddy routes only websocket upgrades to the WS gateway and keeps HTTP GraphQL on web", () => {
  for (const [name, caddy] of [["server", caddyServer], ["local", caddyLocal]] as const) {
    const activeLines = caddy
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join("\n");

    assert.match(activeLines, /@ws\s*\{[\s\S]*path \/graphql[\s\S]*header Connection \*Upgrade\*[\s\S]*header Upgrade websocket[\s\S]*\}/, `${name} Caddyfile must gate WS by upgrade headers`);
    assert.match(activeLines, /reverse_proxy @ws ws:8080/, `${name} Caddyfile must send websocket upgrades to ws`);
    assert.match(activeLines, /@gql_http path \/graphql\*/, `${name} Caddyfile must keep an HTTP GraphQL matcher`);
    assert.match(activeLines, /reverse_proxy @gql_http web:3000/, `${name} Caddyfile must send HTTP GraphQL to web`);
    assert.doesNotMatch(activeLines, /reverse_proxy \/graphql\* ws:8080/, `${name} Caddyfile must not send every /graphql request to ws`);
  }
});

test("production compose refuses to start rather than boot a gateway that rejects every browser", () => {
  // `apps/ws` throw ตั้งแต่ import ถ้า WS_ALLOWED_ORIGINS ว่างบน production (fail-closed ถูกแล้ว)
  // แต่ปล่อยให้ไปตายในคอนเทนเนอร์ = crash-loop เงียบ ๆ ที่ต้องไปขุดใน log · `:?` ทำให้
  // `docker compose up` หยุดตั้งแต่ยังไม่สร้างคอนเทนเนอร์ พร้อมบอกว่าต้องตั้งอะไร
  assert.ok(
    composeProd.includes("WS_ALLOWED_ORIGINS: ${WS_ALLOWED_ORIGINS:?"),
    "docker-compose.prod.yml ต้องบังคับ WS_ALLOWED_ORIGINS ด้วย ${VAR:?...} ไม่ใช่ปล่อยว่างแล้วให้คอนเทนเนอร์ crash-loop",
  );
});

test("development WS keeps Linux dependencies outside macOS bind mounts", () => {
  // `./apps/ws:/app/apps/ws` also exposes the host's node_modules unless a narrower volume
  // shadows it. A macOS esbuild binary makes `tsx watch` stay alive while the actual gateway
  // crashes, so Docker reports "running" but Caddy returns 502 forever.
  for (const mount of [
    "ws_node_modules:/app/apps/ws/node_modules",
    "realtime_node_modules:/app/packages/realtime/node_modules",
    "graphql_core_node_modules:/app/packages/graphql-core/node_modules",
  ]) {
    assert.ok(composeDev.includes(`- ${mount}`), `${mount} must isolate Linux dependencies`);
    assert.match(composeDev, new RegExp(`^  ${mount.split(":")[0]}:$`, "m"));
  }
});

test("realtime Redis commands fail fast instead of hanging, and log once instead of flooding", () => {
  // ของเดิมตั้งแต่ `maxRetriesPerRequest: null` อย่างเดียว = คำสั่งคิวไว้ตลอดกาล ·
  // ผลที่วัดได้ตอน Redis ล่ม: `/readyz` ไม่ตอบอะไรเลย และ socket ที่ ticket ถูกต้องค้างเปิด
  // โดยไม่มีทั้ง ack และ close → เบราว์เซอร์ค้างที่ "connecting" โดยไม่ retry
  assert.match(pubsub, /commandTimeout: commandTimeoutMs\(\)/);
  assert.match(pubsub, /REALTIME_REDIS_COMMAND_TIMEOUT_MS/);
  // ค่าที่พิมพ์ผิดต้องตกกลับค่าปริยาย ไม่ใช่ throw — โมดูลนี้ถูก import โดยทั้ง web และ ws
  assert.doesNotMatch(pubsub, /throw new Error\("REALTIME_REDIS_COMMAND_TIMEOUT_MS/);
  // ไม่มีผู้ฟัง error = ioredis พ่น stack ทุกครั้งที่ retry จนกลบ error จริงบน production
  assert.match(pubsub, /attachRedisErrorLog\(publisher, .publisher.\)/);
  assert.match(pubsub, /attachRedisErrorLog\(subscriber, .subscriber.\)/);
  assert.match(pubsub, /REALTIME_REDIS_UNAVAILABLE/);
});

test("the browser client bounds its wait for connection_ack so a hung socket retries", () => {
  // ค่าปริยายของ graphql-ws คือรอ ack ตลอดกาล · gateway ตอบ ack หลังถาม Redis
  // ถ้า Redis เงียบ socket จะเปิดค้างโดยไม่มีทั้ง ack และ close แล้ว retryWait ไม่มีวันถูกเรียก
  assert.match(browserClient, /connectionAckWaitTimeout: [0-9_]+,/);
  assert.match(browserClient, /retryAttempts: Infinity/);
});

test("gateway metrics separate a dependency outage from a rejected credential", () => {
  // Redis ล่มทำให้ onConnect ปฏิเสธเหมือน ticket ปลอม · นับรวมกันแล้วหน้า /metrics จะอ่านว่า
  // "มีคนพยายามปลอม ticket เป็นพัน" ตอนที่ของจริงคือ dependency ล่ม แล้วคนไล่เหตุจะไล่ผิดทาง
  assert.match(gateway, /dependencyFailures: 0,/);
  assert.match(gateway, /metrics\.dependencyFailures \+= 1/);
  assert.match(gateway, /kind: isAuth \? "auth" : "dependency"/);
});

test("a legacy realtime publish can never fail the business write it follows", () => {
  // realtime เป็น invalidation hint · แถวถูก commit ไปแล้วตอนที่ publish เกิด ดังนั้น Redis ที่ล่ม
  // ต้องแปลว่า "จอรู้ช้าลง" ไม่ใช่ "ส่งข้อความไม่สำเร็จ" · ตั้งแต่ commandTimeout เข้ามา ความล้ม
  // เกิดเร็วขึ้นมาก กฎนี้จึงกลายเป็นของที่ต้องบังคับ ไม่ใช่ของที่พึ่งโชคว่า Redis ไม่ล่ม
  const roots = ["../apps/web/graphql", "../apps/web/lib", "../apps/web/app"];
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir)) {
      const child = new URL(`${dir.href}/${entry}`);
      if (statSync(child).isDirectory()) { walk(child); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const source = readFileSync(child, "utf8");
      // `void pubsub.publish(...).catch(...)` ก็ไม่ลากงานล้มตามเหมือนกัน จึงยอมรับได้
      if (/await pubsub\.publish\(/.test(source)) offenders.push(entry);
    }
  };
  for (const root of roots) walk(new URL(root, import.meta.url));
  assert.deepEqual(
    offenders,
    [],
    `ใช้ publishRealtimeHint() แทน: ${offenders.join(", ")}`,
  );
  assert.match(pubsub, /export async function publishRealtimeHint/);

  // ...แต่ขา outbox ต้อง throw ต่อไป ไม่งั้น dispatcher จะ ack ของที่ไม่เคยถึง Redis
  const dispatcher = readFileSync(new URL("../apps/web/lib/bms/realtimeDispatcher.ts", import.meta.url), "utf8");
  assert.match(dispatcher, /publishRealtimeEvent/);
  assert.doesNotMatch(dispatcher, /publishRealtimeHint/);
});
