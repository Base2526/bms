// packages/realtime/src/pubsub.ts
import { Redis } from 'ioredis';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import type { RedisOptions } from 'ioredis';
import { safePubSubLogValue } from './events.js';

const runtimeProcess = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process;
const runtimeEnv = runtimeProcess?.env ?? {};
const url = runtimeEnv.REDIS_URL || 'redis://redis:6379';

/**
 * ⚠️ `maxRetriesPerRequest: null` อย่างเดียวแปลว่า "คิวคำสั่งไว้ตลอดกาล" ไม่ใช่ "ทนทาน"
 *
 * ของเดิมไม่มี `commandTimeout` เลย · Redis ล่มหรือรีสตาร์ท คำสั่งจะไม่ throw และไม่คืนค่า:
 * `/readyz` ของ ws **ไม่ตอบอะไรเลย** (healthcheck ที่ timeout 5 วินาทีจึงไม่มีคำตอบให้ตัดสิน)
 * และ handshake ที่ ticket ถูกต้องจะค้างเป็น socket ที่เปิดอยู่โดยไม่มี ack ไม่มี close —
 * เบราว์เซอร์จึงค้างที่ "connecting" ตลอดไปแทนที่จะ retry (พิสูจน์ด้วยการปิด Redis แล้วยิงจริง)
 *
 * timeout ทำให้ทุกเส้นทางกลายเป็น "ล้มเร็ว" ซึ่งชั้นบนรับมือได้อยู่แล้ว: onConnect ปฏิเสธ
 * connection, `/readyz` ตอบ 503, dispatcher nack แล้ว retry ตาม backoff ของตัวเอง
 *
 * อ่านค่าแบบ clamp ไม่ throw โดยตั้งใจ — โมดูลนี้ถูก import โดยทั้ง web และ ws ค่าที่พิมพ์ผิด
 * ต้องไม่ทำให้ทั้งสอง service ตายตั้งแต่ boot
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
function commandTimeoutMs(): number {
  const raw = runtimeEnv.REALTIME_REDIS_COMMAND_TIMEOUT_MS;
  if (!raw) return DEFAULT_COMMAND_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 250 || parsed > 30_000) {
    console.error('[realtime-pubsub] REALTIME_REDIS_COMMAND_TIMEOUT_MS ใช้ไม่ได้ ใช้ค่าปริยายแทน', {
      errorCode: 'INVALID_REDIS_COMMAND_TIMEOUT',
      fallbackMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return parsed;
}

const opts: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  commandTimeout: commandTimeoutMs(),
};
const publisher = new Redis(url, opts);
// `commandTimeout` ของ subscriber จับเฉพาะ "คำสั่ง" (subscribe/unsubscribe/ping) ไม่ได้จับ
// การรอรับข้อความ pub/sub ซึ่งไม่ใช่คำสั่ง — สายที่เงียบอยู่จึงไม่ถูกตัดทิ้ง
const subscriber = new Redis(url, opts);

// ไม่มีผู้ฟัง `error` = ioredis พ่น "Unhandled error event" พร้อม stack เต็มทุกครั้งที่ retry
// ซึ่งบน production คือ log หลายพันบรรทัดต่อนาทีที่กลบ error จริง · ที่นี่ยุบเหลือบรรทัดเดียว
// ต่อสายต่อ 30 วินาที พร้อม `errorCode` ที่ค้นได้ · ห้าม throw — การต่อใหม่เป็นหน้าที่ของ ioredis
// และชั้นบน (commandTimeout / dispatcher backoff / retryWait ของ client) รับมืออยู่แล้ว
const ERROR_LOG_INTERVAL_MS = 30_000;
function attachRedisErrorLog(client: Redis, role: 'publisher' | 'subscriber'): void {
  let lastLoggedAt = 0;
  client.on('error', (error: unknown) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt = now;
    console.error('[realtime-pubsub] redis connection error', {
      errorCode: 'REALTIME_REDIS_UNAVAILABLE',
      role,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
attachRedisErrorLog(publisher, 'publisher');
attachRedisErrorLog(subscriber, 'subscriber');

export const pubsub = new RedisPubSub({
  publisher,
  subscriber,
});

/**
 * ส่ง "สัญญาณให้ไปโหลดใหม่" แบบที่ล้มแล้วไม่ลากงานธุรกิจล้มตาม
 *
 * realtime เป็น invalidation hint — PostgreSQL คือแหล่งความจริง · การที่ Redis ล่มต้องแปลว่า
 * "จอจะรู้ช้าลงจนกว่าจะ refresh เอง" ไม่ใช่ "ส่งข้อความไม่สำเร็จ" ทั้งที่แถวถูก commit ไปแล้ว
 *
 * ผู้เรียกยัง `await` ได้เหมือนเดิม ลำดับโค้ดหลังจากนี้จึงไม่เปลี่ยน — เปลี่ยนแค่ว่าความล้ม
 * ไม่ไหลออกไป · **ห้ามใช้กับ `publishRealtimeEvent()` ของ outbox dispatcher** ที่นั่นต้อง throw
 * เพื่อให้ nack แล้ว retry ตาม backoff ของตัวเอง
 */
export async function publishRealtimeHint(triggerName: string, payload: unknown): Promise<boolean> {
  try {
    await pubsub.publish(triggerName, payload);
    return true;
  } catch (error) {
    console.error('[realtime-pubsub] hint publish failed (business write already committed)', {
      errorCode: 'REALTIME_HINT_PUBLISH_FAILED',
      triggerName,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function isRealtimeRedisPong(value: unknown): boolean {
  if (typeof value === 'string') return value.toUpperCase() === 'PONG';
  return Array.isArray(value) && value.some(
    (item) => typeof item === 'string' && item.toUpperCase() === 'PONG',
  );
}

export async function realtimeRedisPing(): Promise<boolean> {
  // Redis returns ["pong", ""] for PING once this connection is in subscriber
  // mode. Treat both that shape and the normal publisher response as healthy.
  return isRealtimeRedisPong(await publisher.ping())
    && isRealtimeRedisPong(await subscriber.ping());
}

export async function readRealtimeRedisValue(key: string): Promise<string | null> {
  return publisher.get(key);
}

const ACQUIRE_LEASE_SCRIPT = `
for i, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  local maximum = tonumber(ARGV[i])
  if current >= maximum then return 0 end
end
for i, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('PEXPIRE', key, ARGV[#KEYS + 1])
end
return 1
`;

const RELEASE_LEASE_SCRIPT = `
for i, key in ipairs(KEYS) do
  local current = tonumber(redis.call('GET', key) or '0')
  if current <= 1 then redis.call('DEL', key) else redis.call('DECR', key) end
end
return 1
`;

/** Fleet-wide bounded connection lease using the publisher connection already owned here. */
export async function acquireRealtimeConnectionLease(
  limits: ReadonlyArray<{ key: string; maximum: number }>,
  ttlMs: number,
): Promise<boolean> {
  if (limits.length < 1 || limits.length > 3) throw new Error('invalid realtime lease scope count');
  const result = await publisher.eval(
    ACQUIRE_LEASE_SCRIPT,
    limits.length,
    ...limits.map((item) => item.key),
    ...limits.map((item) => String(item.maximum)),
    String(ttlMs),
  );
  return Number(result) === 1;
}

export async function refreshRealtimeConnectionLease(keys: readonly string[], ttlMs: number): Promise<boolean> {
  if (keys.length === 0) return true;
  const pipeline = publisher.pipeline();
  for (const key of keys) pipeline.pexpire(key, ttlMs);
  const results = await pipeline.exec();
  return Boolean(results) && results!.every(([error, renewed]) => !error && Number(renewed) === 1);
}

export async function releaseRealtimeConnectionLease(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await publisher.eval(RELEASE_LEASE_SCRIPT, keys.length, ...keys);
}

export async function closeRealtimeRedis(): Promise<void> {
  await Promise.allSettled([publisher.quit(), subscriber.quit()]);
}

// --- DEBUG HOOKS ---
const DBG = runtimeEnv.PUBSUB_DEBUG === '1';

if (DBG) {
  const _origPublish = pubsub.publish.bind(pubsub);
  // พ่น log ทุกครั้งที่มี publish (ไม่ต้องแก้ callsite อื่น ๆ)
  pubsub.publish = async (triggerName: string, payload: unknown) => {
    try {
      console.log('[pubsub][publish] = ', triggerName, JSON.stringify(safePubSubLogValue(payload)));
    } catch {}
    return _origPublish(triggerName, payload as any);
  };

  const _origIterator = pubsub.asyncIterator.bind(pubsub);
  // พ่น log ตอน subscribe ด้วย
  pubsub.asyncIterator = ((triggers: string | string[]) => {
    const t = Array.isArray(triggers) ? triggers.join(',') : triggers;
    console.log('[pubsub][asyncIterator] = ', t);
    return _origIterator(triggers);
  }) as typeof pubsub.asyncIterator;
}

// เผื่ออยากเรียกตรง ๆ
export const dbgPublish = async (trigger: string, payload: any) => {
  if (DBG) console.log('[pubsub][dbgPublish] = ', trigger, JSON.stringify(safePubSubLogValue(payload)));
  return pubsub.publish(trigger, payload);
};
