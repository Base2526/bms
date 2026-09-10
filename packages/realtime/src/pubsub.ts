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
const opts: RedisOptions = { lazyConnect: true, maxRetriesPerRequest: null };
const publisher = new Redis(url, opts);
const subscriber = new Redis(url, opts);

export const pubsub = new RedisPubSub({
  publisher,
  subscriber,
});

export async function realtimeRedisPing(): Promise<boolean> {
  return (await publisher.ping()) === 'PONG' && (await subscriber.ping()) === 'PONG';
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
