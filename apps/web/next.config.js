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

    return config;
  },
  transpilePackages: [ "antd", "events" ],

  productionBrowserSourceMaps: false,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  
};

export default nextConfig;
