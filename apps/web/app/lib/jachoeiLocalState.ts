export const BLOCKED_TEL_STORE_KEY = "jachoei.blocked_tel_v1";
export const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";
export const TEL_BLOCK_DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel

export const JACHOEI_CLIENT_ID_KEY = "jachoei.client_id_v1";

export const JACHOEI_SYNC_EVENT = "jachoei-storage-sync";

export type StoredBlockedTelEntry = {
  wantReport?: boolean;
  category?: "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
  note?: string;
  blockedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredReportedBankEntry = {
  bank_name?: string | null;
  category?: "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";
  note?: string;
  reportedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredBlockedTelMap = Record<string, StoredBlockedTelEntry>;
export type StoredReportedBankMap = Record<string, StoredReportedBankEntry>;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function normalizeTel(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeBank(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function readLocalJson(key: string): unknown {
  if (!isBrowser()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeLocalJson(key: string, value: unknown): void {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function sanitizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function sanitizeBlockedTelEntry(input: unknown): StoredBlockedTelEntry {
  const base = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const wantReport = typeof base.wantReport === "boolean" ? base.wantReport : undefined;
  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SPAM" || categoryRaw === "SCAM" || categoryRaw === "SALES" || categoryRaw === "HARASS" || categoryRaw === "OTHER"
      ? categoryRaw
      : undefined;
  const note = typeof base.note === "string" ? base.note : undefined;
  const blockedAt = typeof base.blockedAt === "string" ? base.blockedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return {
    wantReport,
    category,
    note,
    blockedAt,
    tags,
    ctx,
  };
}

function sanitizeReportedBankEntry(input: unknown): StoredReportedBankEntry {
  const base = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const bank_name = typeof base.bank_name === "string" ? base.bank_name : base.bank_name === null ? null : undefined;
  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SCAM" || categoryRaw === "MONEY_MULE" || categoryRaw === "SALES_ADS" || categoryRaw === "DISPUTE" || categoryRaw === "OTHER"
      ? categoryRaw
      : undefined;
  const note = typeof base.note === "string" ? base.note : undefined;
  const reportedAt = typeof base.reportedAt === "string" ? base.reportedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return {
    bank_name,
    category,
    note,
    reportedAt,
    tags,
    ctx,
  };
}

function getBlockedTelMapRaw(): StoredBlockedTelMap {
  const parsed = readLocalJson(BLOCKED_TEL_STORE_KEY);

  const out: StoredBlockedTelMap = {};

  if (Array.isArray(parsed)) {
    // legacy: ["tel", ...]
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeTel(v);
      if (!k) continue;
      out[k] = {};
    }
    // migrate
    writeLocalJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeTel(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeBlockedTelEntry(v);
        continue;
      }

      if (v) {
        // truthy legacy values
        out[k] = {};
      }
    }

    // heal keys if normalization changed
    writeLocalJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  return out;
}

function getReportedBankMapRaw(): StoredReportedBankMap {
  const parsed = readLocalJson(REPORTED_BANK_STORE_KEY);

  const out: StoredReportedBankMap = {};

  if (Array.isArray(parsed)) {
    // legacy: ["account", ...]
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeBank(v);
      if (!k) continue;
      out[k] = {};
    }
    // migrate
    writeLocalJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeBank(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeReportedBankEntry(v);
        continue;
      }

      if (v) {
        out[k] = {};
      }
    }

    writeLocalJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  return out;
}

export function emitSync(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(JACHOEI_SYNC_EVENT));
}

export function subscribeSync(cb: () => void): () => void {
  if (!isBrowser()) return () => undefined;

  const onCustom = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== window.localStorage) return;
    if (!e.key) return;
    if (e.key === BLOCKED_TEL_STORE_KEY || e.key === REPORTED_BANK_STORE_KEY) {
      cb();
    }

    if (e.key.startsWith(TEL_BLOCK_DONT_ASK_PREFIX)) {
      cb();
    }
  };

  window.addEventListener(JACHOEI_SYNC_EVENT, onCustom);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(JACHOEI_SYNC_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function isBlockedTel(tel: string): boolean {
  const t = normalizeTel(tel);
  if (!t) return false;
  const map = getBlockedTelMapRaw();
  return !!map[t];
}

export function toggleBlockedTel(tel: string): { blocked: boolean } {
  const t = normalizeTel(tel);
  if (!t) return { blocked: false };

  const map = getBlockedTelMapRaw();
  let blocked: boolean;

  if (map[t]) {
    delete map[t];
    blocked = false;
  } else {
    map[t] = {};
    blocked = true;
  }

  writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
  emitSync();

  return { blocked };
}

export function isReportedBank(account: string): boolean {
  const acc = normalizeBank(account);
  if (!acc) return false;
  const map = getReportedBankMapRaw();
  return !!map[acc];
}

export function toggleReportedBank(account: string): { reported: boolean } {
  const acc = normalizeBank(account);
  if (!acc) return { reported: false };

  const map = getReportedBankMapRaw();
  let reported: boolean;

  if (map[acc]) {
    delete map[acc];
    reported = false;
  } else {
    map[acc] = {};
    reported = true;
  }

  writeLocalJson(REPORTED_BANK_STORE_KEY, map);
  emitSync();

  return { reported };
}

export function getBlockedTelSet(): Set<string> {
  const map = getBlockedTelMapRaw();
  return new Set(Object.keys(map));
}

export function getReportedBankSet(): Set<string> {
  const map = getReportedBankMapRaw();
  return new Set(Object.keys(map));
}

export function getBlockedTelEntry(tel: string): StoredBlockedTelEntry | null {
  const t = normalizeTel(tel);
  if (!t) return null;
  const map = getBlockedTelMapRaw();
  return map[t] ? { ...map[t] } : null;
}

export function setBlockedTelEntry(tel: string, entry: StoredBlockedTelEntry): void {
  const t = normalizeTel(tel);
  if (!t) return;

  const map = getBlockedTelMapRaw();
  map[t] = sanitizeBlockedTelEntry(entry);
  writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
  emitSync();
}

export function removeBlockedTelEntry(tel: string): void {
  const t = normalizeTel(tel);
  if (!t) return;

  const map = getBlockedTelMapRaw();
  if (map[t]) {
    delete map[t];
    writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
    emitSync();
  }
}

export function getReportedBankEntry(account: string): StoredReportedBankEntry | null {
  const acc = normalizeBank(account);
  if (!acc) return null;
  const map = getReportedBankMapRaw();
  return map[acc] ? { ...map[acc] } : null;
}

export function setReportedBankEntry(account: string, entry: StoredReportedBankEntry): void {
  const acc = normalizeBank(account);
  if (!acc) return;

  const map = getReportedBankMapRaw();
  map[acc] = sanitizeReportedBankEntry(entry);
  writeLocalJson(REPORTED_BANK_STORE_KEY, map);
  emitSync();
}

export function removeReportedBankEntry(account: string): void {
  const acc = normalizeBank(account);
  if (!acc) return;

  const map = getReportedBankMapRaw();
  if (map[acc]) {
    delete map[acc];
    writeLocalJson(REPORTED_BANK_STORE_KEY, map);
    emitSync();
  }
}

export function getDontAskAgainKeyForTel(tel: string): string {
  const t = normalizeTel(tel);
  return `${TEL_BLOCK_DONT_ASK_PREFIX}${t}`;
}

export function getDontAskAgainForTel(tel: string): boolean {
  if (!isBrowser()) return false;
  const key = getDontAskAgainKeyForTel(tel);
  if (key === TEL_BLOCK_DONT_ASK_PREFIX) return false;

  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setDontAskAgainForTel(tel: string, value: boolean): void {
  if (!isBrowser()) return;
  const key = getDontAskAgainKeyForTel(tel);
  if (key === TEL_BLOCK_DONT_ASK_PREFIX) return;

  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // ignore
  }

  emitSync();
}

export function getJachoeiClientId(): string {
  if (!isBrowser()) return "";

  try {
    const existing = window.localStorage.getItem(JACHOEI_CLIENT_ID_KEY);
    if (existing && existing.trim()) return existing;

    const uuid =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = Math.floor(Math.random() * 16);
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });

    window.localStorage.setItem(JACHOEI_CLIENT_ID_KEY, uuid);
    return uuid;
  } catch {
    return "";
  }
}
