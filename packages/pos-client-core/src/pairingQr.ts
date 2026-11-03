/** Shared Admin/native QR contract. No URL polyfill or native dependency required. */
export interface QrPairingTarget {
  serverUrl: string;
  token: string;
}

const TOKEN = /^pos_[A-Za-z0-9_-]{16,128}$/;

/** Only a complete HTTPS origin reachable from another device can be advertised. */
function qrOrigin(value: string): string | null {
  if (value !== value.trim()) return null;
  const match = /^https:\/\/([^/?#@\s]+)\/?$/i.exec(value);
  if (!match) return null;
  const authority = match[1].toLowerCase();
  const [host, port, extra] = authority.split(":");
  if (host.length > 253) return null;
  if (
    extra !== undefined ||
    (port !== undefined && (!/^\d+$/.test(port) || +port < 1 || +port > 65535))
  )
    return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const octets = host.split(".");
    if (
      octets.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || +part > 255) ||
      +octets[0] === 127 ||
      +octets[0] === 0 ||
      +octets[0] >= 224
    )
      return null;
  } else if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
  ) {
    return null;
  }
  return `https://${host}${port && +port !== 443 ? `:${+port}` : ""}`;
}

export function buildPairingQr(target: QrPairingTarget): string | null {
  const origin = qrOrigin(target.serverUrl);
  if (
    !origin ||
    target.token !== target.token.trim() ||
    !TOKEN.test(target.token)
  )
    return null;
  const value = `bmspos://pair?t=${encodeURIComponent(
    target.token
  )}&h=${encodeURIComponent(origin)}`;
  return value.length <= 2048 ? value : null;
}

export function parsePairingQr(raw: string): QrPairingTarget | null {
  const value = raw.trim();
  if (
    raw.length > 2048 ||
    !value.startsWith("bmspos://pair?") ||
    /[#\s]/.test(value)
  )
    return null;
  const fields: Record<string, string> = Object.create(null);
  try {
    for (const part of value.slice("bmspos://pair?".length).split("&")) {
      const pieces = part.split("=");
      if (pieces.length !== 2) return null;
      const key = decodeURIComponent(pieces[0]);
      if ((key !== "t" && key !== "h") || fields[key] !== undefined)
        return null;
      fields[key] = decodeURIComponent(pieces[1]);
    }
  } catch {
    return null;
  }
  if (
    !fields.t ||
    fields.t !== fields.t.trim() ||
    !TOKEN.test(fields.t) ||
    !fields.h
  )
    return null;
  const origin = qrOrigin(fields.h);
  return origin ? { serverUrl: origin, token: fields.t } : null;
}
