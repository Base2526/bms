import type { RealtimeEvent } from "./events.js";
import { validateRealtimeEvent } from "./events.js";
import { topicForAudience, topicForEvent, type RealtimeTopicAudience } from "./topics.js";

export const REALTIME_EVENT_PAYLOAD_KEY = "realtimeEvent" as const;

export interface RealtimePublisher {
  publish(triggerName: string, payload: unknown): Promise<unknown>;
}

export interface RealtimeSubscriber {
  asyncIterator<T>(triggers: string | readonly string[]): AsyncIterable<T>;
}

export interface RealtimePublishedPayload {
  realtimeEvent: RealtimeEvent;
}

export async function publishRealtimeEvent(
  publisher: RealtimePublisher,
  candidate: unknown,
): Promise<RealtimeEvent> {
  const event = validateRealtimeEvent(candidate);
  await publisher.publish(topicForEvent(event), { [REALTIME_EVENT_PAYLOAD_KEY]: event });
  return event;
}

export function subscribeRealtimeEvents(
  subscriber: RealtimeSubscriber,
  audience: RealtimeTopicAudience,
): AsyncIterable<RealtimePublishedPayload> {
  return subscriber.asyncIterator<RealtimePublishedPayload>(topicForAudience(audience));
}
