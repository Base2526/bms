// apps/web/next.config.js  (ESM syntax)
import path from 'path';
import { fileURLToPath } from 'url';

/** recreate __dirname in ESM */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.env.NODE_ENV === "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // appDir: true,
    optimizePackageImports: ['antd'],
    externalDir: true,
    // Next spawns up to (CPUs - 1) parallel build workers, each its own V8
    // isolate that can grow independently. On a 10-CPU host that's ~9 workers
    // competing for the Docker Desktop VM's memory at once — the aggregate
    // demand can exceed the VM's total RAM even though any single worker's
    // heap looks fine, causing an OOM inside `next build`. Cap concurrency so
    // total memory pressure stays predictable (override via NEXT_BUILD_CPUS
    // for machines with more RAM to spare).
    cpus: Number(process.env.NEXT_BUILD_CPUS) || 2,
  },
  // ✅ Cache header สำหรับ SVG
  async headers() {
    return [
      {
        source: "/:path*\\.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
   // ✅ Remove console.* in production (via SWC)
  // - by default removes: console.log/info/debug
  // - keeps: console.error/warn (recommended)
  compiler: isProd
    ? {
        // removeConsole: {
        //   exclude: [ /*"error", "warn"*/ ],
        // },
        removeConsole: true,
      }
    : undefined,
  webpack: (config, { isServer }) => {
    // alias ไปที่แพ็กเกจ core (src) เพื่อ dev-hot-reload
    config.resolve.alias['@core'] = path.resolve(__dirname, '../../packages/graphql-core/src');

    // ✅ กันไฟล์ server-only เผลอถูก bundle ฝั่ง client
    // (ถ้า client ไป import เข้า จะให้มัน fail เร็ว ๆ หรือ ignore)
    if (!isServer) {
      config.resolve.alias["@social/queue.server"] = false;
      config.resolve.alias["@social/pubsub.server"] = false;
    }

    return config;
  },
  transpilePackages: [ "antd", "events", "social-queue" ],

  productionBrowserSourceMaps: false,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  
};

export default nextConfig;
