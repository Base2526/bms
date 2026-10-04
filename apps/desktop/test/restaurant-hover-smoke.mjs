import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const output = path.resolve(here, "../dist-smoke/restaurant-hover");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const variants = [
  ["btn btnPrimary ticketGo", "Start whole ticket"],
  ["catCard catCardActive", "Category"],
  ["menuTool menuToolOn", "Menu mode"],
  ["menuTool menuToolAlert menuToolOn", "Sold out"],
  ["areaButton areaButtonActive", "Dining area"],
  ["kitchenFilter kitchenFilterOn", "Kitchen station"],
  ["quickQtyBtn quickQtyOn", "Quantity"],
  ["railBtn railBtnActive", "Kitchen"],
];

async function run() {
  await mkdir(output, { recursive: true });
  await build({ stdin: {
    contents: 'import styles from "./app/(pos)/pos/restaurant/restaurant.module.css"; window.styles = styles;',
    resolveDir: web, sourcefile: "hover-fixture.js",
  }, bundle: true, outfile: path.join(output, "fixture.js"), platform: "browser" });
  const posCss = await readFile(path.join(web, "app/(pos)/pos/pos.css"), "utf8");
  const moduleCss = await readFile(path.join(output, "fixture.css"), "utf8");
  const win = new BrowserWindow({ show: false, width: 1100, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    win.webContents.debugger.attach("1.3");
    const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
    for (const reverse of [false, true]) {
      await writeFile(path.join(output, "fixture.html"), `<!doctype html><html lang="th"><meta charset="utf-8">
        <style>${reverse ? moduleCss + posCss : posCss + moduleCss}</style>
        <body style="margin:0"><main class="pos-root"><div id="fixture"></div></main><script src="fixture.js"></script></body></html>`);
      await win.loadFile(path.join(output, "fixture.html"));
      await win.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('#fixture'); root.className = styles.page;
        root.style.cssText = 'display:block;height:auto;min-height:100vh;padding:24px';
        ${JSON.stringify(variants)}.forEach(([classes, label], index) => {
          const row = document.createElement('div'); row.style.cssText = 'margin-bottom:16px;max-width:340px';
          const button = document.createElement('button'); button.id = 'variant-' + index;
          button.className = classes.split(' ').map(key => styles[key]).join(' ');
          button.textContent = index === 0 ? '\u0e40\u0e23\u0e34\u0e48\u0e21\u0e17\u0e33 \u0e17\u0e31\u0e49\u0e07\u0e43\u0e1a' : label;
          const icon = document.createElement('span'); icon.textContent = ' \u2192'; button.append(icon);
          row.append(button); root.append(row);
        });
      })()`);
      await cdp("DOM.enable"); await cdp("CSS.enable");
      const { root } = await cdp("DOM.getDocument");
      for (const dark of [false, true]) {
        await win.webContents.executeJavaScript(`document.documentElement.classList.toggle('dark', ${dark})`);
        for (const width of [1100, 390]) {
          win.setContentSize(width, 900);
          for (const [index, [classes]] of variants.entries()) {
            const selector = `#variant-${index}`;
            const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
            const colors = () => win.webContents.executeJavaScript(`(() => {
              const button = document.querySelector('${selector}'), style = getComputedStyle(button);
              return { color: style.color, background: style.backgroundColor,
                icon: getComputedStyle(button.querySelector('span')).color };
            })()`);
            await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
            await win.webContents.executeJavaScript("new Promise(done => setTimeout(done, 150))");
            const normal = await colors();
            assert.notEqual(normal.color, normal.background, classes);
            for (const states of [["hover"], ["hover", "active"], ["focus", "focus-visible"]]) {
              await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: states });
              await win.webContents.executeJavaScript("new Promise(done => setTimeout(done, 150))");
              assert.deepEqual(await colors(), normal, `${classes}: ${states}, dark=${dark}, width=${width}, reverse=${reverse}`);
              if (index === 0 && states.length === 1 && !reverse) {
                await writeFile(path.join(output, `hover-${dark ? 'dark' : 'light'}-${width}.png`),
                  (await win.webContents.capturePage()).toPNG());
              }
            }
            await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
            await win.webContents.executeJavaScript(`document.querySelector('${selector}').disabled = true`);
            await win.webContents.executeJavaScript("new Promise(done => setTimeout(done, 150))");
            assert.deepEqual(await colors(), normal, `${classes}: disabled`);
            await win.webContents.executeJavaScript(`document.querySelector('${selector}').disabled = false`);
            await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
          }
          assert.equal(await win.webContents.executeJavaScript("document.documentElement.scrollWidth > innerWidth"), false);
        }
      }
    }
    console.log(`Restaurant buttons: 8 variants, hover/active/focus/disabled, light/dark, desktop/mobile, both stylesheet orders passed. Screenshots: ${output}`);
  } finally { win.destroy(); }
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
