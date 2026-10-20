import { readFile } from "node:fs/promises";
import { apiRouteInventoryV1Schema } from "../packages/fleet-delivery-contracts/src/index.js";

const [inventoryRaw, serverSource, humanInventory] = await Promise.all([
  readFile(new URL("../docs/delivery/phase-17/api-route-inventory.json", import.meta.url), "utf8"),
  readFile(new URL("../apps/fleet-delivery-api/src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../docs/delivery/phase-8/api-and-event-inventory.md", import.meta.url), "utf8"),
]);
const inventory = apiRouteInventoryV1Schema.parse(JSON.parse(inventoryRaw));

type DiscoveredRoute = {
  method: string;
  matcherType: "STATIC" | "DYNAMIC";
  matcherValue: string;
  scope: string | null;
  idempotencyRequired: boolean;
};

const branches: Array<DiscoveredRoute & { index: number }> = [];
for (const match of serverSource.matchAll(
  /if \(req\.method === "(GET|POST|PUT|PATCH|DELETE)" && pathname === "([^"]+)"\) \{/g,
)) {
  branches.push({
    method: match[1]!,
    matcherType: "STATIC",
    matcherValue: match[2]!,
    scope: null,
    idempotencyRequired: false,
    index: match.index,
  });
}
for (const match of serverSource.matchAll(
  /if \(req\.method === "(GET|POST|PUT|PATCH|DELETE)" && ([a-z][A-Za-z0-9]+Match)\) \{/g,
)) {
  branches.push({
    method: match[1]!,
    matcherType: "DYNAMIC",
    matcherValue: match[2]!,
    scope: null,
    idempotencyRequired: false,
    index: match.index,
  });
}
branches.sort((left, right) => left.index - right.index);
branches.forEach((branch, index) => {
  const block = serverSource.slice(branch.index, branches[index + 1]?.index ?? serverSource.length);
  const scopes = [...block.matchAll(/authenticateMutation\(deps, req, "([a-z0-9.]+)"\)/g)]
    .map((match) => match[1]!);
  const customerActions = [...block.matchAll(/authenticateCustomer\(deps, req, "(QUOTE|CREATE_DELIVERY|TRACK)"\)/g)]
    .map((match) => match[1]!);
  if (scopes.length + customerActions.length > 1) {
    throw new Error(`route branch has multiple authorization scopes: ${branch.matcherValue}`);
  }
  branch.scope = scopes[0] ?? customerActions[0] ?? null;
  branch.idempotencyRequired = block.includes("requireIdempotencyKey(");
});

const discoveredByMatcher = new Map(branches.map((branch) => [
  `${branch.matcherType}:${branch.matcherValue}`,
  branch,
]));
if (discoveredByMatcher.size !== inventory.routes.length || branches.length !== inventory.routes.length) {
  throw new Error(`route count drift: source=${branches.length} contract=${inventory.routes.length}`);
}

for (const route of inventory.routes) {
  const matcherValue = route.matcher.type === "STATIC" ? route.matcher.literal : route.matcher.variable;
  const discovered = discoveredByMatcher.get(`${route.matcher.type}:${matcherValue}`);
  if (discovered === undefined) throw new Error(`route matcher missing from source: ${route.id}`);
  if (discovered.method !== route.method || discovered.scope !== route.scope
    || discovered.idempotencyRequired !== route.idempotencyRequired) {
    throw new Error(`route contract drift: ${route.id}`);
  }
  if (route.matcher.type === "DYNAMIC") {
    const normalizedSource = serverSource.replace(/\s/g, "");
    const expectedMatcher = `const${route.matcher.variable}=pathname.match(/${route.matcher.regexSource}/`;
    if (!normalizedSource.includes(expectedMatcher)) throw new Error(`dynamic route regex drift: ${route.id}`);
  }
  const scopeCell = route.scope === null ? "" : ` | \`${route.scope}\` |`;
  if ((route.access === "SERVICE" || route.access === "CUSTOMER_GRANT")
    && !humanInventory.includes(`| \`${route.method} ${route.pathTemplate}\`${scopeCell}`)) {
    throw new Error(`human API inventory is missing route/scope: ${route.id}`);
  }
  if (route.access === "PUBLIC_HEALTH" && !humanInventory.includes(`\`${route.method} ${route.pathTemplate}\``)) {
    throw new Error(`human API inventory is missing health route: ${route.id}`);
  }
}

process.stdout.write(`${JSON.stringify({
  phase: inventory.phase,
  mode: inventory.mode,
  productionAuthorized: inventory.productionAuthorized,
  routeCount: inventory.routes.length,
  publicHealthRouteCount: inventory.routes.filter((route) => route.access === "PUBLIC_HEALTH").length,
  serviceRouteCount: inventory.routes.filter((route) => route.access === "SERVICE").length,
  customerGrantRouteCount: inventory.routes.filter((route) => route.access === "CUSTOMER_GRANT").length,
  scopedRouteCount: inventory.routes.filter((route) => route.scope !== null).length,
  idempotentMutationCount: inventory.routes.filter((route) => route.idempotencyRequired).length,
  verified: true,
}, null, 2)}\n`);
