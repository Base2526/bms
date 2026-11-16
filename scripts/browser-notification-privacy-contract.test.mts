import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("../apps/web/node_modules/typescript");

for (const name of ["GlobalInboxNotifier", "GlobalOrderNotifier", "GlobalFailureNotifier",
  "GlobalMentionNotifier", "GlobalChatListener"]) {
  test(`${name} keeps customer and order details off OS notifications`, () => {
    const file = new URL(`../apps/web/components/${name}.tsx`, import.meta.url);
    const source = ts.createSourceFile(name, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let notifications = 0;
    const visit = (node: import("../apps/web/node_modules/typescript").Node) => {
      const isHelper = ts.isCallExpression(node) && node.expression.getText(source) === "notify";
      const isNative = ts.isNewExpression(node) && node.expression.getText(source) === "Notification";
      if (isHelper || isNative) {
        notifications += 1;
        const args = node.arguments ?? [];
        assert.match(args[0]?.getText(source) ?? "", /^t\("order_notifications\.[a-z_]+"\)$/,
          "OS title must be a generic translated label");
        if (args[1] && ts.isObjectLiteralExpression(args[1])) {
          assert.equal(args[1].properties.some((property) => ts.isPropertyAssignment(property)
            && property.name.getText(source) === "body"), false, "OS body must contain no private detail");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(notifications > 0, "the privacy check must find a notification call");
  });
}
