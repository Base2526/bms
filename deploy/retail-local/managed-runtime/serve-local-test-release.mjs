#!/usr/bin/env node

import { createServer } from "node:https";
import { createReadStream } from "node:fs";
import { appendFile, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import process from "node:process";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("argument is invalid");
    values.set(name, value);
  }
  return values;
}

const args = parseArguments(process.argv.slice(2));
const rootArgument = args.get("--root");
const root = resolve(rootArgument ?? "");
const certPath = args.get("--cert");
const keyPath = args.get("--key");
const logPath = args.get("--log");
const port = Number.parseInt(args.get("--port") ?? "", 10);
if (!rootArgument || !certPath || !keyPath || !logPath || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("usage: node serve-local-test-release.mjs --root DIR --cert FILE --key FILE --log FILE --port PORT");
}

async function log(message) {
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`, { encoding: "utf8", mode: 0o600 });
}

function contentType(path) {
  return extname(path) === ".json" ? "application/json; charset=utf-8" : "application/octet-stream";
}

function resolveRequestPath(requestUrl) {
  const parsed = new URL(requestUrl, `https://localhost:${port}`);
  const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const candidate = resolve(root, relative);
  if (!candidate.startsWith(root + sep)) return null;
  return candidate;
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return false;
  const start = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return false;
  }
  return { start, end };
}

const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)]);
const server = createServer({ cert, key }, async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const path = resolveRequestPath(request.url ?? "/");
    if (!path) {
      response.writeHead(404);
      response.end();
      return;
    }
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      response.writeHead(404);
      response.end();
      return;
    }
    if (!metadata.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const range = parseRange(request.headers.range, metadata.size);
    if (range === false) {
      response.writeHead(416, { "Content-Range": `bytes */${metadata.size}` });
      response.end();
      return;
    }
    const status = range ? 206 : 200;
    const start = range?.start ?? 0;
    const end = range?.end ?? metadata.size - 1;
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(end - start + 1),
      "Content-Type": contentType(path),
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${metadata.size}`;
    response.writeHead(status, headers);
    await log(`${request.method} ${new URL(request.url, "https://localhost").pathname} ${status}`);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path, { start, end }).pipe(response);
  } catch (error) {
    await log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});

server.listen(port, "127.0.0.1", async () => {
  await log(`READY https://localhost:${port} root=${root}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
