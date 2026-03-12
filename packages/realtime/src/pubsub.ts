// packages/realtime/src/pubsub.ts
import { Redis } from 'ioredis';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import type { RedisOptions } from 'ioredis';

const url = process.env.REDIS_URL || 'redis://redis:6379';
const opts: RedisOptions = { lazyConnect: true, maxRetriesPerRequest: null };

export const pubsub = new RedisPubSub({
  publisher: new Redis(url, opts),
  subscriber: new Redis(url, opts),
});

// --- DEBUG HOOKS ---
const DBG = process.env.PUBSUB_DEBUG === '1';

if (DBG) {
  const _origPublish = pubsub.publish.bind(pubsub);
  // พ่น log ทุกครั้งที่มี publish (ไม่ต้องแก้ callsite อื่น ๆ)
  pubsub.publish = async (triggerName: string, payload: unknown) => {
    try {
      console.log('[pubsub][publish] = ', triggerName, JSON.stringify(payload));
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
  if (DBG) console.log('[pubsub][dbgPublish] = ', trigger, JSON.stringify(payload));
  return pubsub.publish(trigger, payload);
};
