import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const root = path.resolve(import.meta.dirname, "../..");

function textOf(node) {
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span, i) => `{v${i}}${span.literal.text}`).join("");
  return ts.isJsxText(node) ? node.text.replace(/\s+/g, " ").trim() : node.text;
}

function translated(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isPropertyAssignment(parent)) {
      const name = parent.name?.getText();
      if (["name_th", "name_en"].includes(name)) return true;
      if (["th", "en"].includes(name) && ts.isObjectLiteralExpression(parent.parent)
        && parent.parent.properties.some(p => p.name?.getText() === (name === "th" ? "en" : "th"))) return true;
    }
    if (ts.isCallExpression(parent) && ["uiText", "tr", "posText", "receiptText", "receiptLabel", "t", "tx", "c", "label", "text", "L"].includes(parent.expression.getText())) return true;
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === "style") return true;
    if (ts.isConditionalExpression(parent) && /\b(?:lang|isEnglish|isEn|locale|language|english|isThai|en|th)\b/i.test(parent.condition.getText())) return true;
    if (ts.isTaggedTemplateExpression(parent)) return true;
  }
  return false;
}

function visibleEnglish(node) {
  if (ts.isJsxText(node)) return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return /^(title|label|placeholder|alt|aria-label|okText|cancelText|description|message|enterButton|help|extra|checkedChildren|unCheckedChildren|tip|emptyText)$/.test(parent.name.getText());
    if (ts.isPropertyAssignment(parent)) return /^(title|label|message|description|content|okText|cancelText|emptyText|showTotal)$/.test(parent.name.getText());
    if (ts.isCallExpression(parent)) {
      if (/\.(filter|join)$/.test(parent.expression.getText()) && parent.expression.expression?.pos <= node.pos && parent.expression.expression?.end >= node.end) continue;
      return /^(message\.(success|error|warning|info)|alert|confirm|prompt)$/.test(parent.expression.getText());
    }
    if (ts.isNewExpression(parent)) return parent.expression.getText() === "Error";
    if (ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))) return true;
    if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return false;
  }
  return false;
}

/** Follow reachable shared UI, without traversing business services or generated clients. */
export function auditAdminUi() {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) files.push(file);
    }
  }
  walk("apps/web/app/(admin)");
  files.push("apps/web/app/error.tsx", "apps/web/components/HeaderBar.tsx");
  const candidates = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i], source = readFileSync(path.join(root, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function imports(node) {
      if (ts.isStringLiteral(node) && ((ts.isImportDeclaration(node.parent) && node.parent.moduleSpecifier === node)
        || (ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword))) {
        const ref = node.text;
        const base = ref.startsWith("@/components/") ? path.join(root, "apps/web", ref.slice(2))
          : ref.startsWith(".") ? path.resolve(root, path.dirname(file), ref) : null;
        if (base) for (const suffix of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
          const target = path.relative(root, base + suffix);
          if (existsSync(base + suffix) && !files.includes(target) && !target.includes("/lib/bms/")) { files.push(target); break; }
        }
      }
      ts.forEachChild(node, imports);
    }
    imports(ast);
    // These prose pages use complete, separately authored bilingual content trees.
    if (["/admin/manual/page.tsx", "/admin/pharmacy-manual/page.tsx", "/admin/architecture/page.tsx"].some(p => file.endsWith(p))) continue;
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isJsxText(node)) && !translated(node)) {
        const text = textOf(node);
        const thai = /[ก-๙]/.test(text.replaceAll("฿", ""));
        if (thai || (/[a-zA-Z]{2}/.test(text) && visibleEnglish(node))) {
          candidates.push({ file: file.split(path.sep).join("/"), text, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
          if (ts.isTemplateExpression(node)) { node.templateSpans.forEach(span => visit(span.expression)); return; }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return { files, candidates };
}
