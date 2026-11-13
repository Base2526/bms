import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPosTranslator } from '../apps/web/i18n/posClient.ts';
import { validatePayments } from '../packages/pos-client-core/src/payment.ts';
import { describePosConnectionFailure } from '../packages/pos-client-core/src/connectionFailure.ts';
import { describePosFailure, describeTransportFailure } from '../apps/web/lib/pos/failureMessage.ts';
import { checkoutBlockReason } from '../apps/web/lib/pos/paymentDraft.ts';
import { describeUnmetModifierGroups } from '../apps/web/lib/pos/modifierSelection.ts';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const english = JSON.parse(readFileSync(new URL('apps/web/i18n/pos-client.json', root), 'utf8'));
const variables = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('POS translation pairs preserve every placeholder and provide nonempty English copy', () => {
  for (const [source, translation] of Object.entries(english)) {
    assert.equal(typeof translation, 'string', source);
    assert.ok((translation as string).trim(), source);
    assert.deepEqual(variables(translation as string), variables(source), source);
  }
});

test('authored mobile and Desktop register translation calls resolve in the shared catalog', () => {
  let checked = 0;
  function walk(relative: string) {
    for (const entry of readdirSync(new URL(relative, root), { withFileTypes: true })) {
      const file = relative + '/' + entry.name;
      if (entry.isDirectory()) { if (!['graphql', 'mocks', 'i18n'].includes(entry.name)) walk(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = readFileSync(new URL(file, root), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node: any) {
        if (ts.isCallExpression(node) && (node.expression.getText(ast) === 'posText'
          || (file === 'apps/mobile/src/components/ReceiptPaper.tsx' && node.expression.getText(ast) === 'receiptText'))
          && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          assert.ok(Object.hasOwn(english, key), `${file}: missing ${key}`);
          checked++;
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  walk('apps/mobile/src');
  walk('apps/web/components/pos-desktop');
  walk('apps/web/components/pos');
  walk('apps/web/app/(pos)/pos');
  walk('apps/web/lib/pos');
  assert.ok(checked > 1800, `Only checked ${checked} call sites`);
});

test('English connection failures retain uncertainty, permission and diagnostic semantics', () => {
  const en = createPosTranslator('en');
  for (const status of [401, 403, 429, 502, 504]) {
    const th = describePosConnectionFailure({ httpStatus: status }, true);
    const result = describePosConnectionFailure({ httpStatus: status }, true, en);
    const { message: originalMessage, ...original } = th;
    const { message, ...actual } = result;
    assert.deepEqual(actual, original);
    assert.notEqual(message, originalMessage);
    assert.match(message, new RegExp(result.code));
    if (result.outcome === 'unknown') assert.match(message, /Do not collect payment again/);
  }
  assert.match(describeTransportFailure(502, true, 'POST', en), /transaction result is unknown/);
  assert.doesNotMatch(describeTransportFailure(502, true, 'GET', en), /transaction result/);
  assert.match(describePosFailure({ status: 'SERIAL_REQUIRED', sku: 'ชื่อไทย', expected: 2, received: 1 }, en), /ชื่อไทย: 2 serial numbers required \(1 entered\)/);
});

test('interpolation preserves operator data verbatim and does not translate inserted values', () => {
  const en = createPosTranslator('en'), th = createPosTranslator('th');
  assert.equal(en('ชื่อสินค้าจากเซิร์ฟเวอร์'), 'ชื่อสินค้าจากเซิร์ฟเวอร์');
  assert.equal(en('หมวด {v0}', { v0: 'ชื่อไทย {v1}' }), 'Category ชื่อไทย {v1}');
  assert.equal(th('หมวด {v0}', { v0: 0 }), 'หมวด 0');
  assert.equal(en('หมวด {v0}', { v0: '' }), 'Category ');
});

test('POS action labels remain distinct from completed and voided statuses', () => {
  const en = createPosTranslator('en');
  assert.equal(en('ยกเลิก'), 'Cancel');
  assert.equal(en('ยกเลิกแล้ว'), 'Cancelled');
  assert.equal(en('ยกเลิกบิลแล้ว'), 'Voided');
  assert.equal(en('ใช้แต้ม'), 'Use points');
  assert.equal(en('งาน'), 'Operations');
  assert.equal(en('รอรับสินค้า'), 'Awaiting receipt');
});

test('payment language changes labels only, preserving balances and validation decisions', () => {
  const payments = [{ id: 'test', method: 'cash' as const, amount: 50, tendered: 40 }];
  const thai = validatePayments(100, payments, createPosTranslator('th'));
  const englishResult = validatePayments(100, payments, createPosTranslator('en'));
  const { errors: thaiErrors, ...thaiAmounts } = thai;
  const { errors: englishErrors, ...englishAmounts } = englishResult;
  assert.deepEqual(englishAmounts, thaiAmounts);
  assert.match(thaiErrors.join(' '), /เงินสด/);
  assert.match(englishErrors.join(' '), /Cash tendered/);
  assert.match(englishErrors.join(' '), /Remaining ฿50.00/);
});

test('restaurant validation translates amounts while retaining raw modifier names', () => {
  const en = createPosTranslator('en');
  const cash = { id: 'cash', method: 'CASH', amount: '40', tendered: '35', ref: '' };
  assert.equal(checkoutBlockReason([cash], 50, en), 'Total payment is short by ฿10.00');
  assert.equal(checkoutBlockReason([cash], 30, en), 'Total payment exceeds the amount due by ฿10.00');
  assert.equal(checkoutBlockReason([cash], 40, en), 'Cash tendered is less than the cash allocation');
  assert.equal(checkoutBlockReason([{ ...cash, tendered: '40' }], 40, en), null);
  assert.equal(describeUnmetModifierGroups(['ความหวาน'], en), 'Still required: ความหวาน');
});

test('POS operator surfaces cannot introduce untranslated Thai copy outside declared bilingual sources', () => {
  const uncovered: string[] = [];
  const catalogSources = new Set([
    'queueBoardAudioPreference.ts', 'queueBoardLayoutPreference.ts', 'scanManager.ts', 'pointsEarnMessage.ts',
  ]);
  function walk(relative: string) {
    for (const entry of readdirSync(new URL(relative, root), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['graphql', 'mocks', 'i18n'].includes(entry.name)) walk(file);
        continue;
      }
      if (!/\.tsx?$/.test(file)) continue;
      // Official tax copy has its own document language; manual has full TH/EN content pairs;
      // announcement voice and glyph samples deliberately follow separate printer/voice settings.
      if (['TaxInvoiceCopy.tsx', 'posManualContent.tsx', 'pickupQueueVoice.ts', 'LanguageSelector.tsx'].includes(entry.name)) continue;
      const source = readFileSync(new URL(file, root), 'utf8');
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node: any) {
        const copy = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
          ? node.text
          : ts.isTemplateExpression(node)
            ? node.head.text + node.templateSpans.map((span: any, i: number) => `{v${i}}${span.literal.text}`).join('') : '';
        if (/[\u0E01-\u0E3A\u0E40-\u0E5B]/.test(copy)) {
          let translated = false;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (ts.isCallExpression(parent) && ['posText', 't', 'tx', 'c', 'receiptText', 'receiptLabel'].includes(parent.expression.getText(ast))) translated = true;
            if (ts.isCallExpression(parent) && ['ReceiptPaper.tsx', 'escpos.ts', 'posSaleReceipt.ts'].includes(entry.name)
              && ['label', 'text'].includes(parent.expression.getText(ast))) translated = true;
            if (ts.isConditionalExpression(parent) && /lang|isEnglish|isEn|locale|language/i.test(parent.condition.getText(ast))) translated = true;
            if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(ast) === 'style') translated = true;
            if (ts.isJsxAttribute(parent) && parent.name.text === 'label'
              && parent.parent.parent.tagName.getText(ast) === 'DesktopModuleLoading') translated = true;
          }
          // Authored option/validation sources are translated by their callers; reject unknown additions.
          if (catalogSources.has(entry.name)) {
            assert.ok(Object.hasOwn(english, copy), `${file}: missing catalog source ${copy}`);
            translated = true;
          }
          const intentional = ['Language / ภาษา', 'ไทย'].includes(copy)
            || (/^use\w+ ต้อง(?:อยู่ใต้|ถูกเรียกใต้) <\w+Provider>$/.test(copy))
            || (file.includes('/navigation/') && /navigator|navigation|Navigator|MainTabs/.test(copy))
            || (entry.name === 'PrinterSettingsScreen.tsx' && copy === 'ภาษาไทย · ABC 0123456789')
            || (entry.name === 'mobileFlowGraphql.ts' && copy === 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
          if (!translated && !intentional) uncovered.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${copy.trim()}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  for (const dir of ['apps/mobile/src', 'apps/web/components/pos-desktop', 'apps/web/components/pos', 'apps/web/app/(pos)/pos', 'apps/web/lib/pos']) walk(dir);
  assert.deepEqual(uncovered, []);
});
