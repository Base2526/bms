const TOKEN_SHAPE = /^pos_[A-Za-z0-9_-]{16,}$/;

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function normalizeServerUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) return null;
  if (!parsed.hostname || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

export function parsePairingInput({ serverUrl, pairingInput }) {
  const input = String(pairingInput ?? "").trim();
  if (!input) return { ok: false, error: "กรุณาวางลิงก์จับคู่หรือ token ของเครื่องขาย" };

  let token = input;
  let serverFromLink = null;
  if (/^https?:\/\//i.test(input)) {
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      return { ok: false, error: "ลิงก์จับคู่ไม่ถูกต้อง" };
    }
    token = parsed.searchParams.get("t") ?? parsed.searchParams.get("token") ?? "";
    serverFromLink = normalizeServerUrl(parsed.origin);
    if (!token) return { ok: false, error: "ลิงก์นี้ไม่มี token กรุณาคัดลอกลิงก์จับคู่จากหน้าจัดการเครื่อง POS" };
  } else if (/^bmspos:\/\//i.test(input)) {
    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      return { ok: false, error: "ลิงก์ bmspos ไม่ถูกต้อง" };
    }
    token = parsed.searchParams.get("t") ?? parsed.searchParams.get("token") ?? "";
    const host = parsed.searchParams.get("h") ?? parsed.searchParams.get("host") ?? parsed.searchParams.get("server");
    serverFromLink = host ? normalizeServerUrl(host) : null;
  }

  if (!TOKEN_SHAPE.test(token)) return { ok: false, error: "token ไม่ถูกต้อง ต้องขึ้นต้นด้วย pos_ และคัดลอกมาให้ครบ" };
  const normalizedServer = serverFromLink ?? normalizeServerUrl(serverUrl);
  if (!normalizedServer) return { ok: false, error: "Server URL ไม่ถูกต้อง ระบบจริงต้องใช้ HTTPS" };
  return { ok: true, serverUrl: normalizedServer, token };
}

export function parsePairingHandoff(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "expiresAt,serverUrl,token,version") return null;
  if (input.version !== 1 || typeof input.expiresAt !== "string") return null;
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 15 * 60_000) return null;
  const parsed = parsePairingInput({ serverUrl: input.serverUrl, pairingInput: input.token });
  return parsed.ok ? parsed : null;
}
