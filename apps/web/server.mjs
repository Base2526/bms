import { createServer } from "node:http";
import next from "next";

import { configureWebHttpServer } from "./server-config.mjs";

const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const app = next({
  dev: false,
  dir: process.cwd(),
  hostname,
  port,
});

await app.prepare();

const handleRequest = app.getRequestHandler();
const handleUpgrade = app.getUpgradeHandler();
const server = createServer((request, response) => {
  handleRequest(request, response);
});
const timeouts = configureWebHttpServer(server);

server.on("upgrade", (request, socket, head) => {
  handleUpgrade(request, socket, head);
});

server.listen(port, hostname, () => {
  console.log(
    `[web] listening on http://${hostname}:${port}; requestTimeout=${timeouts.requestTimeoutMs}ms`,
  );
});

