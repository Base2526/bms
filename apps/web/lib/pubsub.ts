// Re-export the single shared RedisPubSub instance instead of opening a second
// publisher+subscriber connection pair to the same Redis server. `apps/ws` and
// `apps/web` both end up on this one module (via packages/realtime), so every
// `pubsub.publish(...)` call in this process reaches the exact same client
// `packages/graphql-core`'s subscription resolvers listen on.
// No ".js" extension here (unlike packages/graphql-core/src/resolvers.ts's import of the same
// module) — apps/web is bundled by Next's webpack, not tsc, and webpack does not do TypeScript's
// NodeNext-style ".js" → ".ts" source-extension rewriting; it looked for a literal pubsub.js file
// (which only exists under packages/realtime/dist/, not src/) and failed the build. Next's default
// webpack `resolve.extensions` already includes ".ts", so the extension-less specifier resolves to
// pubsub.ts directly under this project's "moduleResolution": "Bundler".
export { pubsub } from "../../../packages/realtime/src/pubsub";
