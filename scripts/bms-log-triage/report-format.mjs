// The collector sends this report to a model. Every database field is untrusted.
export function redactLogReportText(value, max = 2_000) {
  return String(value ?? "")
    .replace(/["']?\b(?:authorization|password|passcode|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|device[_-]?token|cookie|pin)["']?\s*[:=]\s*(?:["'][^"']*["']|[^\s"'&,;}]+)/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?\b/g, "[REDACTED]")
    .replace(/\b(?:sk-|xox[baprs]-|gh[pousr]_|pos_)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\benc:[A-Za-z0-9+/=:]{8,}/gi, "[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
    .replace(/(?:\+66[689]\d{8}|\b0[689]\d{8}\b)/g, "[PHONE]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]")
    .replace(/\b\d{10,19}\b/g, "[NUMBER]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[HEX]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[REDACTED]")
    .slice(0, max);
}

function inline(value, max = 2_000) {
  return redactLogReportText(value, max)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\`*_{}\[\]()#+.!>|]/g, "\\$&");
}

export function formatLogReport(rows, { today, hours }) {
  let md = `# BMS Log Triage — ${today}\n\n`;
  md += `Window: ${hours} hours · groups: ${rows.length} · all exported fields redacted\n\n`;
  rows.forEach((row, index) => {
    md += `## ${index + 1}. [${inline(row.source, 30)} / ${inline(row.category, 80)}] ${inline(row.msg)}\n`;
    md += `- Count: ${Number(row.cnt) || 0} · latest: ${new Date(row.last_at).toISOString()}`;
    md += row.route ? ` · route: ${inline(row.route, 300)}\n` : "\n";
    if (row.sample_stack) {
      const stack = redactLogReportText(row.sample_stack, 12_000)
        .split("\n").slice(0, 20).join("\n").replace(/```/g, "''' ");
      md += `\n\`\`\`text\n${stack}\n\`\`\`\n`;
    }
    md += "\n";
  });
  return md;
}
