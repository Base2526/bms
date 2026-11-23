/** Validate GraphQL multipart paths before passing FormData to the third-party uploader. */
export function validGraphqlUploadMap(form: FormData): boolean {
  const rawMap = form.get("map");
  const rawOperations = form.get("operations");
  if (form.getAll("map").length !== 1 || form.getAll("operations").length !== 1 ||
      typeof rawMap !== "string" || rawMap.length > 64 * 1024 ||
      typeof rawOperations !== "string" || rawOperations.length > 1024 * 1024) return false;

  let map: unknown;
  let operations: unknown;
  try {
    map = JSON.parse(rawMap);
    operations = JSON.parse(rawOperations);
  } catch {
    return false;
  }
  if (!map || typeof map !== "object" || Array.isArray(map) ||
      !operations || typeof operations !== "object" || Array.isArray(operations)) return false;
  const request = operations as Record<string, unknown>;
  if (typeof request.query !== "string" || !request.query.trim() ||
      !request.variables || typeof request.variables !== "object" || Array.isArray(request.variables)) return false;

  const slots = Object.entries(map);
  if (slots.length < 1 || slots.length > 200) return false;
  const mappedPaths = new Set<string>();
  for (const [slot, paths] of slots) {
    // The browser upload client uses numeric file slots. This also avoids inherited
    // keys on the uploader's plain `files` object (for example `toString`).
    if (!/^(0|[1-9][0-9]{0,3})$/.test(slot) || form.getAll(slot).length > 1 ||
        !Array.isArray(paths) || paths.length < 1 || paths.length > 200) return false;
    for (const path of paths) {
      if (typeof path !== "string") return false;
      // Two files must never race to replace the same variable placeholder.
      if (mappedPaths.has(path)) return false;
      mappedPaths.add(path);
      const parts = path.split(".");
      if (parts.length < 2 || parts.length > 32 || parts[0] !== "variables") return false;
      let current: unknown = request.variables;
      for (const part of parts.slice(1)) {
        if (part === "__proto__" || part === "constructor" || part === "prototype") return false;
        if (Array.isArray(current)) {
          if (!/^(0|[1-9][0-9]*)$/.test(part) || !Object.hasOwn(current, part)) return false;
        } else if (current && typeof current === "object") {
          if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(part) || !Object.hasOwn(current, part)) return false;
        } else {
          return false;
        }
        current = (current as Record<string, unknown>)[part];
      }
      // The multipart spec uses null placeholders. Do not let a map overwrite other inputs.
      if (current !== null) return false;
    }
  }
  return true;
}
