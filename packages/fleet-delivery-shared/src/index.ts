import { Redis } from "ioredis";

export class ConfigurationError extends Error {
  constructor(readonly key: string) {
    super(`Missing or invalid required configuration: ${key}`);
    this.name = "ConfigurationError";
  }
}

export function requiredEnv(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigurationError(key);
  return value;
}

export function optionalPositiveInt(
  key: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigurationError(key);
  return value;
}

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
  });
}

export interface ObjectStore {
  putPrivate(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getPrivate(key: string): Promise<Uint8Array>;
}

export class DisabledObjectStore implements ObjectStore {
  async putPrivate(): Promise<never> {
    throw new Error("OBJECT_STORAGE_DISABLED");
  }

  async getPrivate(): Promise<never> {
    throw new Error("OBJECT_STORAGE_DISABLED");
  }
}
