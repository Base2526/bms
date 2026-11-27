export function staffWebPreferences(preload) {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
    webSecurity: true, partition: "bms-kiosk-staff" };
}

export function guestWebPreferences(partition) {
  if (!/^bms-kiosk-customer-[0-9a-f-]{36}$/.test(partition)) throw new Error("Invalid guest partition");
  return { contextIsolation: true, nodeIntegration: false, sandbox: true,
    webSecurity: true, partition };
}

export function guestMayNavigate(target, boundUrl) { return target === boundUrl; }

export function redactExternalReferrer(requestUrl, boundOrigin, requestHeaders) {
  let external = true;
  try { external = new URL(requestUrl).origin !== boundOrigin; } catch {}
  if (!external) return requestHeaders;
  const safe = { ...requestHeaders };
  for (const name of Object.keys(safe)) if (name.toLowerCase() === "referer") delete safe[name];
  return safe;
}
