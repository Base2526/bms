import { defineConfig } from "tsup";

const common = {
  bundle: true,
  clean: true,
  dts: false,
  format: ["esm" as const],
  minify: false,
  platform: "node" as const,
  sourcemap: true,
  splitting: false,
  target: "node22",
  tsconfig: "tsconfig.fleet-delivery.json",
};

export default defineConfig([
  {
    ...common,
    entry: {
      main: "apps/fleet-delivery-api/src/main.ts",
      migrate: "apps/fleet-delivery-api/src/migrate.ts",
    },
    outDir: "dist/fleet-delivery-api",
  },
  {
    ...common,
    entry: { main: "apps/fleet-delivery-worker/src/main.ts" },
    outDir: "dist/fleet-delivery-worker",
  },
]);
