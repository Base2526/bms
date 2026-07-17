import { GraphQLError } from "graphql/error";
import { createHash, randomBytes } from "crypto";

interface RequireAuthOptions {
  optional?: boolean;      // soft mode → ไม่ throw
  optionalWeb?: boolean;   // soft เฉพาะเว็บ
  optionalAdmin?: boolean; // soft เฉพาะ admin
  optionalAndroid?: boolean; // soft เฉพาะ android (เพิ่ม)
}

type Scope = "web" | "admin" | "android"; // ✅ เพิ่ม android

function unauthorizedScope(opts: RequireAuthOptions) {
  if (opts.optional || opts.optionalWeb || opts.optionalAdmin || opts.optionalAndroid) {
    return { scope: null, author_id: null, isAuthenticated: false };
  }
  throw new GraphQLError("Unauthorized scope", {
    extensions: {
      code: "UNAUTHENTICATED",
      reason: "invalid_scope",
      http: { status: 401 },
    },
  });
}

export function requireAuth(ctx: any, opts: RequireAuthOptions = {}) {

  // console.log("[requireAuth] =" ,ctx);
  const scopeRaw = ctx?.scope;
  const scope = (typeof scopeRaw === "string" ? scopeRaw : "")
    .trim()
    .toLowerCase() as Scope | "";

  const allowed: Scope[] = ["web", "admin", "android"];

  if (!scope || !allowed.includes(scope as Scope)) {
    return unauthorizedScope(opts);
  }

  let author_id: string | number | null = null;

  // ===== admin =====
  if (scope === "admin") {
    author_id = ctx?.admin?.id ?? null;

    if (!author_id && (opts.optional || opts.optionalAdmin)) {
      return { scope: "admin", author_id: null, isAuthenticated: false };
    }

    if (!author_id) {
      throw new GraphQLError("Admin not authenticated", {
        extensions: {
          code: "UNAUTHENTICATED",
          reason: "backend_admin",
          http: { status: 401 },
        },
      });
    }

    return { scope, author_id, isAuthenticated: true };
  }

  // ===== web + android =====
  // web อนุญาตให้ fallback ไปใช้ admin session ได้
  // เพื่อให้หน้า public/session-aware ใช้ session เดียวกับหลังบ้านได้
  if (scope === "web" || scope === "android") {
    author_id = ctx?.user?.id ?? null;

    if (!author_id && scope === "web") {
      author_id = ctx?.admin?.id ?? null;
    }

    const isSoft =
      opts.optional ||
      (scope === "web" && opts.optionalWeb) ||
      (scope === "android" && opts.optionalAndroid);

    if (!author_id && isSoft) {
      return { scope, author_id: null, isAuthenticated: false };
    }

    if (!author_id) {
      throw new GraphQLError("User not authenticated", {
        extensions: {
          code: "UNAUTHENTICATED",
          reason: scope === "android" ? "android_user" : "frontend_user",
          http: { status: 401 },
        },
      });
    }

    return { scope, author_id, isAuthenticated: true };
  }

  // fallback ปลอดภัย
  if (opts.optional) {
    return { scope: null, author_id: null, isAuthenticated: false };
  }

  throw new GraphQLError("Invalid authentication context", {
    extensions: {
      code: "UNAUTHENTICATED",
      http: { status: 401 },
    },
  });
}

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function generateRawToken() {
  return randomBytes(32).toString("hex");
}
