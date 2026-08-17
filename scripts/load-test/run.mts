import { performance } from "node:perf_hooks";

type ScenarioName =
  | "admin-dashboard"
  | "admin-inbox-list"
  | "admin-inbox-detail"
  | "admin-orders-list"
  | "admin-customer360"
  | "demo-chat"
  | "checkout-read"
  | "pos-session"
  | "pos-scan";

type RequestResult = {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
};

type Session = {
  cookie?: string;
  conversationId?: string;
  customerId?: string;
  channel?: string;
  customerRef?: string;
};

type ScenarioDefinition = {
  name: ScenarioName;
  description: string;
  preflight?: () => void;
  setup?: (workerId: number) => Promise<Session>;
  run: (workerId: number, iteration: number, session: Session) => Promise<RequestResult>;
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.baseUrl || process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const concurrency = numberArg(args.concurrency, process.env.LOAD_CONCURRENCY, 10);
const durationSeconds = numberArg(args.duration, process.env.LOAD_DURATION_SECONDS, 30);
const timeoutMs = numberArg(args.timeout, process.env.LOAD_TIMEOUT_MS, 30000);
const scenarioName = (args.scenario || process.env.LOAD_SCENARIO || "admin-dashboard") as ScenarioName;

const scenarios: Record<ScenarioName, ScenarioDefinition> = {
  "admin-dashboard": {
    name: "admin-dashboard",
    description: "Admin login + GraphQL dashboard-style query",
    preflight: preflightAdminCreds,
    setup: loginAdminSession,
    run: async () => {
      throw new Error("unreachable");
    },
  },
  "admin-inbox-list": {
    name: "admin-inbox-list",
    description: "Admin GraphQL inbox list query (100 conversations)",
    preflight: preflightAdminCreds,
    setup: loginAdminSession,
    run: async () => {
      throw new Error("unreachable");
    },
  },
  "admin-inbox-detail": {
    name: "admin-inbox-detail",
    description: "Admin GraphQL inbox detail query with messages, notes, and system events",
    preflight: preflightAdminCreds,
    setup: async (workerId) => {
      const session = await loginAdminSession(workerId);
      const conversation = await fetchFirstConversation(session.cookie || "", workerId);
      return { ...session, ...conversation };
    },
    run: async () => {
      throw new Error("unreachable");
    },
  },
  "admin-orders-list": {
    name: "admin-orders-list",
    description: "Admin GraphQL orders list query (100 orders)",
    preflight: preflightAdminCreds,
    setup: loginAdminSession,
    run: async () => {
      throw new Error("unreachable");
    },
  },
  "admin-customer360": {
    name: "admin-customer360",
    description: "Admin GraphQL Customer 360 query from a real conversation context",
    preflight: preflightAdminCreds,
    setup: async (workerId) => {
      const session = await loginAdminSession(workerId);
      const conversation = await fetchFirstConversation(session.cookie || "", workerId);
      return { ...session, ...conversation };
    },
    run: async () => {
      throw new Error("unreachable");
    },
  },
  "demo-chat": {
    name: "demo-chat",
    description: "Public demo chat hitting AI pipeline",
    run: async (workerId, iteration) => {
      const demoShopKey = process.env.DEMO_SHOP_KEY || "default";
      const message = process.env.DEMO_MESSAGE || "มีสินค้าแนะนำไหม";
      const body = {
        demoShopKey,
        message,
        sessionId: `loadtest-${workerId}`,
        customerRef: `loadtest-${workerId}-${iteration}`,
      };
      const result = await timedFetch(`${baseUrl}/api/bms/demo-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return toRequestResult(result);
    },
  },
  "checkout-read": {
    name: "checkout-read",
    description: "Public checkout token read",
    preflight: () => {
      requiredEnv("CHECKOUT_TOKEN");
    },
    run: async () => {
      const token = requiredEnv("CHECKOUT_TOKEN");
      const result = await timedFetch(
        `${baseUrl}/api/bms/checkout?t=${encodeURIComponent(token)}`,
        { method: "GET" }
      );
      return toRequestResult(result);
    },
  },
  "pos-session": {
    name: "pos-session",
    description: "POS device authentication + session bootstrap reads",
    preflight: preflightPosDevice,
    run: async () => {
      const result = await timedFetch(`${baseUrl}/api/pos/session`, {
        method: "GET",
        headers: posDeviceHeaders(),
      });
      return toRequestResult(result);
    },
  },
  "pos-scan": {
    name: "pos-scan",
    description: "POS device authentication + canonical barcode/stock lookup",
    preflight: () => {
      preflightPosDevice();
      requiredEnv("POS_SCAN_CODE");
    },
    run: async () => {
      const code = requiredEnv("POS_SCAN_CODE");
      const result = await timedFetch(
        `${baseUrl}/api/pos/scan?code=${encodeURIComponent(code)}`,
        { method: "GET", headers: posDeviceHeaders() }
      );
      return toRequestResult(result);
    },
  },
};

scenarios["admin-dashboard"].run = async (_workerId, _iteration, session) => {
  const query = `
    query LoadTestDashboard {
      bmsMe { id name email role }
      bmsInboxUnreadCount
      bmsDashboard {
        revenueTotal
        orderCount
        customerCount
        lowStockCount
      }
    }
  `;

  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scope": "admin",
      cookie: session.cookie || "",
    },
    body: JSON.stringify({ query }),
  });
  return toRequestResult(result);
};

scenarios["admin-inbox-list"].run = async (_workerId, _iteration, session) => {
  const query = `
    query LoadTestInboxList {
      bmsConversations(limit: 100) {
        id
        channel
        customerRef
        customerName
        sourceDisplayName
        status
        tags
        unread
        lastMessage
        lastMessageAt
        assignedStaff { id name avatar }
      }
    }
  `;
  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(session.cookie || ""),
    body: JSON.stringify({ query }),
  });
  return toRequestResult(result);
};

scenarios["admin-inbox-detail"].run = async (_workerId, _iteration, session) => {
  if (!session.conversationId) {
    throw new Error("missing conversationId in session");
  }
  const query = `
    query LoadTestInboxDetail($id: ID!) {
      bmsConversation(id: $id) {
        id
        channel
        customerRef
        customerId
        customerName
        status
        tags
        unread
        lastMessageAt
        createdAt
        assignedStaff { id name email avatar role isAvailable openCount }
        helpers { id name email avatar role isAvailable openCount }
        messages { id direction body sender createdAt attachment { url name mimeType isImage } status canReportDelivery }
        systemEvents { id kind at actorName targetName statusValue auto }
        notes { id author body createdAt mentionedUserIds }
      }
    }
  `;
  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(session.cookie || ""),
    body: JSON.stringify({ query, variables: { id: session.conversationId } }),
  });
  return toRequestResult(result);
};

scenarios["admin-orders-list"].run = async (_workerId, _iteration, session) => {
  const query = `
    query LoadTestOrdersList {
      bmsOrders(limit: 100, offset: 0) {
        id
        channel
        customer_ref
        status
        total_amount
        discount_amount
        coupon_code
        created_at
        updated_at
        hasShippingAddress
        items { product_sku size qty unit_price }
      }
    }
  `;
  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(session.cookie || ""),
    body: JSON.stringify({ query }),
  });
  return toRequestResult(result);
};

scenarios["admin-customer360"].run = async (_workerId, _iteration, session) => {
  if (!session.conversationId) {
    throw new Error("missing conversationId in session");
  }
  const query = `
    query LoadTestCustomer360($conversationId: ID!, $channel: String, $customerRef: String) {
      bmsCustomer360(conversationId: $conversationId, channel: $channel, customerRef: $customerRef) {
        customer {
          id
          name
          phone
          email
          tags
          createdAt
          preferredLanguage
          timezone
          orderCount
          totalSpent
          isNewCustomer
          isReturningCustomer
        }
        identities { channel externalRef }
        addresses { id label address isDefault addressType }
        stats {
          lifetimeValue
          totalOrders
          avgOrderValue
          completedOrders
          cancelledOrders
          refundCount
          lastOrderDate
          lastConversationAt
          avgResponseTimeSeconds
        }
        recentOrders {
          id
          channel
          status
          createdAt
          totalAmount
          discountAmount
          couponCode
          paymentStatus
          paymentMethod
          shipmentStatus
          carrier
          trackingNo
          items { sku size qty unitPrice }
        }
        products {
          topPurchased { sku name category qty revenue lastPurchasedAt orderCount }
          recentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
          frequentlyPurchased { sku name category qty revenue lastPurchasedAt orderCount }
          favoriteCategories { category qty }
        }
        draftOrder { id channel createdAt totalAmount discountAmount couponCode items { sku size qty unitPrice } }
        notes { id conversationId author body createdAt }
        coupons {
          id
          walletId
          code
          type
          value
          minOrderAmount
          maxRedemptions
          redemptionsCount
          perCustomerLimit
          startsAt
          expiresAt
          active
          note
          available
          reason
          discountPreview
          assigned
          assignedAt
          source
          state
          remainingRedemptions
          customerUsedCount
        }
      }
    }
  `;
  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(session.cookie || ""),
    body: JSON.stringify({
      query,
      variables: {
        conversationId: session.conversationId,
        channel: session.channel || null,
        customerRef: session.customerRef || null,
      },
    }),
  });
  return toRequestResult(result);
};

const scenario = scenarios[scenarioName];
if (!scenario) {
  printUsage(`Unknown scenario: ${scenarioName}`);
  process.exit(1);
}

if (args.help) {
  printUsage();
  process.exit(0);
}

scenario.preflight?.();

console.log(`\n[BMS load-test] scenario=${scenario.name}`);
console.log(`[BMS load-test] description=${scenario.description}`);
console.log(`[BMS load-test] baseUrl=${baseUrl}`);
console.log(`[BMS load-test] concurrency=${concurrency}`);
console.log(`[BMS load-test] durationSeconds=${durationSeconds}`);
console.log(`[BMS load-test] timeoutMs=${timeoutMs}\n`);

const startedAt = performance.now();
const deadline = startedAt + durationSeconds * 1000;
const results: RequestResult[] = [];

await Promise.all(
  Array.from({ length: concurrency }, async (_, index) => {
    const workerId = index + 1;
    let iteration = 0;
    let session: Session = {};

    if (scenario.setup) {
      session = await scenario.setup(workerId);
    }

    while (performance.now() < deadline) {
      iteration += 1;
      try {
        const result = await withTimeout(
          scenario.run(workerId, iteration, session),
          timeoutMs,
          `timeout after ${timeoutMs}ms`
        );
        results.push(result);
      } catch (error) {
        results.push({
          ok: false,
          status: 0,
          durationMs: timeoutMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  })
);

printSummary(results, (performance.now() - startedAt) / 1000);

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--help" || current === "-h") {
      parsed.help = true;
      continue;
    }
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed as Record<string, string> & { help?: boolean };
}

function numberArg(cliValue: string | undefined, envValue: string | undefined, fallback: number) {
  const raw = cliValue ?? envValue;
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid numeric value: ${raw}`);
  }
  return value;
}

function preflightAdminCreds() {
  requiredEnv("BMS_ADMIN_EMAIL");
  requiredEnv("BMS_ADMIN_PASSWORD");
}

function preflightPosDevice() {
  requiredEnv("POS_DEVICE_TOKEN");
}

function posDeviceHeaders() {
  return { "x-pos-device-token": requiredEnv("POS_DEVICE_TOKEN") };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

async function loginAdminSession(workerId: number): Promise<Session> {
  const email = requiredEnv("BMS_ADMIN_EMAIL");
  const password = requiredEnv("BMS_ADMIN_PASSWORD");

  // ไม่มี REST /api/login แล้ว (dead route ที่ไม่มีหน้าไหนเรียกจริง — ถูกลบไปแล้ว) — login จริง
  // ทั้งระบบไปทาง GraphQL mutation `loginAdmin` เท่านั้น (ดู graphql/resolvers.ts, ตัวเดียวกับที่
  // /admin/login เรียก) เซ็ต ADMIN_COOKIE ผ่าน cookies().set() ในตัว resolver เอง
  const loginMutation = `
    mutation LoadTestLogin($input: LoginInput!) {
      loginAdmin(input: $input) { ok message }
    }
  `;
  const login = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: loginMutation, variables: { input: { email, password } } }),
  });

  if (!login.response.ok) {
    throw new Error(`worker ${workerId}: login failed with ${login.response.status}`);
  }
  const loginBody = safeJsonParse(login.text);
  if (loginBody?.errors?.length) {
    throw new Error(`worker ${workerId}: login failed: ${loginBody.errors[0]?.message}`);
  }
  if (!loginBody?.data?.loginAdmin?.ok) {
    throw new Error(`worker ${workerId}: login did not return ok`);
  }

  const rawCookie = login.response.headers.get("set-cookie") || "";
  const adminCookie = rawCookie.split(";")[0];
  if (!adminCookie) {
    throw new Error(`worker ${workerId}: missing admin cookie`);
  }

  const sanityQuery = `
    query LoadTestSanity {
      bmsMe { id email role }
    }
  `;
  const sanity = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(adminCookie),
    body: JSON.stringify({ query: sanityQuery }),
  });
  if (!sanity.response.ok || sanity.text.includes('"errors"')) {
    throw new Error(
      `worker ${workerId}: admin session sanity check failed ` +
        `(status ${sanity.response.status}) ${truncate(sanity.text, 200)}`
    );
  }
  return { cookie: adminCookie };
}

async function fetchFirstConversation(cookie: string, workerId: number): Promise<Session> {
  const query = `
    query LoadTestPickConversation {
      bmsConversations(limit: 20) {
        id
        channel
        customerRef
      }
    }
  `;
  const result = await timedFetch(`${baseUrl}/api/graphql`, {
    method: "POST",
    headers: adminGraphqlHeaders(cookie),
    body: JSON.stringify({ query }),
  });
  if (!result.response.ok || result.text.includes('"errors"')) {
    throw new Error(
      `worker ${workerId}: failed to load conversation seed ` +
        `(status ${result.response.status}) ${truncate(result.text, 200)}`
    );
  }
  const payload = safeJsonParse(result.text);
  const first = payload?.data?.bmsConversations?.[0];
  if (!first?.id) {
    throw new Error(`worker ${workerId}: no conversations available for admin scenario`);
  }
  return {
    conversationId: String(first.id),
    channel: typeof first.channel === "string" ? first.channel : nullToUndefined(first.channel),
    customerRef:
      typeof first.customerRef === "string" ? first.customerRef : nullToUndefined(first.customerRef),
  };
}

function adminGraphqlHeaders(cookie: string) {
  return {
    "content-type": "application/json",
    "x-scope": "admin",
    cookie,
  };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

async function timedFetch(input: string, init: RequestInit) {
  const started = performance.now();
  const response = await fetch(input, init);
  const durationMs = performance.now() - started;
  const text = await response.text().catch(() => "");
  return { response, durationMs, text };
}

function toRequestResult(result: {
  response: Response;
  durationMs: number;
  text: string;
}): RequestResult {
  const graphqlFailure = result.response.ok && result.text.includes('"errors"');

  return {
    ok: result.response.ok && !graphqlFailure,
    status: result.response.status,
    durationMs: result.durationMs,
    error: result.response.ok ? undefined : truncate(result.text, 160),
  };
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function printSummary(results: RequestResult[], elapsedSeconds: number) {
  const latencies = results.map((entry) => entry.durationMs).sort((a, b) => a - b);
  const ok = results.filter((entry) => entry.ok).length;
  const failed = results.length - ok;
  const avg = latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
  const statusCounts = new Map<number, number>();
  for (const result of results) {
    statusCounts.set(result.status, (statusCounts.get(result.status) || 0) + 1);
  }

  console.log("\n=== Summary ===");
  console.log(`requests       ${results.length}`);
  console.log(`success        ${ok}`);
  console.log(`failed         ${failed}`);
  console.log(`successRate    ${results.length ? ((ok / results.length) * 100).toFixed(2) : "0.00"}%`);
  console.log(`elapsed        ${elapsedSeconds.toFixed(2)}s`);
  console.log(`throughput     ${elapsedSeconds > 0 ? (results.length / elapsedSeconds).toFixed(2) : "0.00"} req/s`);
  console.log(`latency avg    ${avg.toFixed(2)} ms`);
  console.log(`latency p50    ${percentile(latencies, 50).toFixed(2)} ms`);
  console.log(`latency p95    ${percentile(latencies, 95).toFixed(2)} ms`);
  console.log(`latency p99    ${percentile(latencies, 99).toFixed(2)} ms`);
  console.log(`latency max    ${percentile(latencies, 100).toFixed(2)} ms`);

  console.log("\nstatus counts");
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${status}: ${count}`);
  }

  const sampleErrors = results.filter((entry) => entry.error).slice(0, 5);
  if (sampleErrors.length) {
    console.log("\nerror samples");
    for (const error of sampleErrors) {
      console.log(`  status=${error.status} message=${error.error}`);
    }
  }
}

function printUsage(error?: string) {
  if (error) console.error(error);
  console.log(`
Usage:
  npx tsx ../../scripts/load-test/run.mts --scenario <name> --concurrency 20 --duration 60

Scenarios:
  admin-dashboard
  admin-inbox-list
  admin-inbox-detail
  admin-orders-list
  admin-customer360
  demo-chat
  checkout-read
  pos-session
  pos-scan

Options:
  --baseUrl       default: BASE_URL or http://localhost:3000
  --concurrency   default: LOAD_CONCURRENCY or 10
  --duration      default: LOAD_DURATION_SECONDS or 30
  --timeout       default: LOAD_TIMEOUT_MS or 30000
  --help
`);
}
