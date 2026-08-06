// Re-export the single shared RedisPubSub instance instead of opening a second
// publisher+subscriber connection pair to the same Redis server. `apps/ws` and
// `apps/web` both end up on this one module (via packages/realtime), so every
// `pubsub.publish(...)` call in this process reaches the exact same client
// `packages/graphql-core`'s subscription resolvers listen on.
export { pubsub } from "../../../packages/realtime/src/pubsub.js";
