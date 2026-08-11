// =============================================================
// S3-compatible driver (AWS S3, Cloudflare R2, MinIO, GCS S3-interop)
// -------------------------------------------------------------
// Implemented with fetch + AWS Signature V4 over node:crypto rather than an SDK
// so this adds no dependency to the web image. Only the four verbs this app
// needs are implemented: PUT object, GET object (incl. ranged), HEAD object.
//
// Enable with STORAGE_DRIVER=s3. Required env:
//   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
// Optional env:
//   S3_REGION           (default "us-east-1")
//   S3_ENDPOINT         (e.g. http://minio:9000 — omit for real AWS)
//   S3_FORCE_PATH_STYLE (default true when S3_ENDPOINT is set)
//   S3_PREFIX           (key prefix, e.g. "bms/")
// =============================================================

import crypto from "crypto";
import { Readable } from "stream";

import type { ByteRange, StorageDriver, StoredStat, WriteResult } from "./index";
import { toStorageKey } from "./index";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: URL;
  pathStyle: boolean;
  prefix: string;
};

function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`STORAGE_DRIVER=s3 requires ${name} to be set`);
  return v;
}

function readConfig(): S3Config {
  const bucket = requireEnv("S3_BUCKET");
  const region = (process.env.S3_REGION || "us-east-1").trim();
  const rawEndpoint = (process.env.S3_ENDPOINT || "").trim();
  const endpoint = new URL(rawEndpoint || `https://s3.${region}.amazonaws.com`);
  const pathStyleRaw = (process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase();
  const pathStyle = pathStyleRaw
    ? pathStyleRaw === "1" || pathStyleRaw === "true" || pathStyleRaw === "yes"
    : Boolean(rawEndpoint);
  const prefix = (process.env.S3_PREFIX || "").replace(/^\/+|\/+$/g, "");

  return {
    bucket,
    region,
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    endpoint,
    pathStyle,
    prefix,
  };
}

const sha256Hex = (data: Buffer | string) =>
  crypto.createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string) =>
  crypto.createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding — encodeURIComponent leaves !'()* alone, S3 does not. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** Encode each path segment but keep the separators literal. */
function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => uriEncode(seg))
    .join("/");
}

function objectKey(cfg: S3Config, relpath: string): string {
  const key = toStorageKey(relpath);
  return cfg.prefix ? `${cfg.prefix}/${key}` : key;
}

function buildUrl(cfg: S3Config, key: string): { url: URL; canonicalPath: string; host: string } {
  const url = new URL(cfg.endpoint.toString());
  let pathname: string;

  if (cfg.pathStyle) {
    pathname = `/${cfg.bucket}/${key}`;
  } else {
    url.hostname = `${cfg.bucket}.${url.hostname}`;
    pathname = `/${key}`;
  }

  const canonicalPath = encodePath(pathname);
  url.pathname = canonicalPath;

  // The Host header must match what is actually sent, port included, or the
  // signature will not verify.
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const host = url.port && url.port !== defaultPort ? `${url.hostname}:${url.port}` : url.hostname;

  return { url, canonicalPath, host };
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signRequest(
  cfg: S3Config,
  method: string,
  canonicalPath: string,
  host: string,
  payloadHash: string,
  extraHeaders: Record<string, string>
): Record<string, string> {
  const { amzDate, dateStamp } = amzDates(new Date());

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v.trim()])
    ),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [
    method,
    canonicalPath,
    "", // no query string is used by any verb here
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    Authorization:
      `${ALGORITHM} Credential=${cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function s3Fetch(
  cfg: S3Config,
  method: "PUT" | "GET" | "HEAD",
  relpath: string,
  opts: { body?: Buffer; contentType?: string; range?: ByteRange } = {}
): Promise<Response> {
  const key = objectKey(cfg, relpath);
  const { url, canonicalPath, host } = buildUrl(cfg, key);

  const payloadHash = opts.body ? sha256Hex(opts.body) : sha256Hex("");
  const extra: Record<string, string> = {};
  if (opts.contentType) extra["content-type"] = opts.contentType;
  if (opts.range) extra["range"] = `bytes=${opts.range.start}-${opts.range.end}`;

  const headers = signRequest(cfg, method, canonicalPath, host, payloadHash, extra);

  return fetch(url.toString(), {
    method,
    headers,
    body: opts.body ? new Uint8Array(opts.body) : undefined,
    // Streaming a PUT would require chunked signing; bodies here are bounded
    // (slips ≤8 MB, generated reports) so a single signed payload is fine.
    // @ts-expect-error — Node's fetch needs this for request bodies.
    duplex: opts.body ? "half" : undefined,
  });
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* body already consumed or empty */
  }
  return new Error(`S3 ${what} failed (HTTP ${res.status}) ${detail}`.trim());
}

export function createS3Driver(): StorageDriver {
  const cfg = readConfig();

  return {
    name: "s3",
    shared: true,

    async write(relpath: string, body: Buffer): Promise<void> {
      const res = await s3Fetch(cfg, "PUT", relpath, { body });
      if (!res.ok) throw await failure(res, `PUT ${relpath}`);
    },

    async writeStream(relpath, stream): Promise<WriteResult> {
      // Buffer the stream: a signed single-part PUT needs the payload hash up
      // front. Uploads that reach this path are avatars/attachments, not bulk
      // data — switch to multipart if that ever stops being true.
      const chunks: Buffer[] = [];
      let size = 0;
      const hash = crypto.createHash("sha256");

      await new Promise<void>((resolve, reject) => {
        stream.on("error", reject);
        stream.on("data", (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(buf);
          size += buf.length;
          hash.update(buf);
        });
        stream.on("end", () => resolve());
      });

      const res = await s3Fetch(cfg, "PUT", relpath, { body: Buffer.concat(chunks) });
      if (!res.ok) throw await failure(res, `PUT ${relpath}`);

      return { size, checksum: hash.digest("hex") };
    },

    async read(relpath: string): Promise<Buffer> {
      const res = await s3Fetch(cfg, "GET", relpath);
      if (!res.ok) throw await failure(res, `GET ${relpath}`);
      return Buffer.from(await res.arrayBuffer());
    },

    async stat(relpath: string): Promise<StoredStat | null> {
      const res = await s3Fetch(cfg, "HEAD", relpath);
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(res, `HEAD ${relpath}`);
      const len = Number(res.headers.get("content-length") || "0");
      return { size: Number.isFinite(len) ? len : 0 };
    },

    async openStream(relpath: string, range?: ByteRange): Promise<Readable> {
      const res = await s3Fetch(cfg, "GET", relpath, { range });
      if (!res.ok) throw await failure(res, `GET ${relpath}`);
      if (!res.body) throw new Error(`S3 GET ${relpath} returned no body`);
      return Readable.fromWeb(res.body as any);
    },
  };
}
