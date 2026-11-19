import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const output = path.resolve(here, "../dist-smoke/restaurant-service-mode");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");

async function run() {
  await mkdir(output, { recursive: true });
  await build({
    stdin: {
      contents: 'import styles from "./app/(pos)/pos/restaurant/restaurant.module.css"; window.styles = styles;',
      resolveDir: web,
      sourcefile: "restaurant-service-mode-fixture.js",
    },
    bundle: true,
    outfile: path.join(output, "fixture.js"),
    platform: "browser",
  });
  const posCss = await readFile(path.join(web, "app/(pos)/pos/pos.css"), "utf8");
  const moduleCss = await readFile(path.join(output, "fixture.css"), "utf8");
  await writeFile(path.join(output, "fixture.html"), `<!doctype html><html lang="th"><meta charset="utf-8">
    <style>${posCss}${moduleCss}</style><body style="margin:0"><main class="pos-root"><div id="fixture"></div></main>
    <script src="fixture.js"></script></body></html>`);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(output, "fixture.html"));
    await win.webContents.executeJavaScript(`(() => {
      const c = (...keys) => keys.map((key) => styles[key]).join(' ');
      const root = document.querySelector('#fixture');
      root.className = styles.page;
      root.style.cssText = 'display:block;height:100vh;min-height:0';
      root.innerHTML = \`
        <div class="\${c('workspace')}" style="height:100%">
          <section class="\${c('panel')}">
            <div class="\${c('panelHeader')}"><div><h2>สั่งอาหาร</h2><small>เลือกประเภทบริการก่อนเริ่มรับออร์เดอร์</small></div></div>
            <section class="\${c('serviceModeEmpty')}" aria-labelledby="service-mode-smoke-title">
              <div class="\${c('serviceModeIntro')}"><h3 id="service-mode-smoke-title">ลูกค้ารับบริการแบบไหน?</h3><p>เลือกประเภทบริการก่อนเริ่มรับออร์เดอร์</p></div>
              <div class="\${c('serviceModeGrid')}">
                <button class="\${c('serviceModeCard')}"><span class="\${c('serviceModeIcon')}">⌂</span><strong>ทานที่ร้าน</strong><span>เลือกโต๊ะ · จำนวนลูกค้า · ส่งครัวเป็นรอบ</span><small>เลือกโต๊ะจากผังในขั้นตอนถัดไป</small></button>
                <button class="\${c('serviceModeCard')}"><span class="\${c('serviceModeIcon')}">▣</span><strong>รับกลับบ้าน</strong><span>เปิดบิลทันที · ไม่ผูกโต๊ะ</span><small>หลังคิดเงินจะออกเลขคิวรับของอัตโนมัติ</small></button>
              </div>
              <p class="\${c('serviceModeHelp')}">เลือกโหมดบริการเพื่อเริ่มบิลใหม่</p>
            </section>
          </section>
          <aside class="\${c('checkPanel')}"><div class="\${c('checkHead')}"><h2>บิลที่เปิดอยู่ · 0</h2></div><div class="\${c('empty')}"><div><h3>ยังไม่มีบิลที่เปิดอยู่</h3><p>เลือกโหมดบริการทางซ้ายเพื่อเริ่ม</p></div></div></aside>
        </div>\`;
    })()`);

    for (const [width, height] of [[1280, 820], [390, 900]]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
      const layout = await win.webContents.executeJavaScript(`(() => {
        const cards = [...document.querySelectorAll('.' + styles.serviceModeCard)].map((node) => {
          const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom };
        });
        const grid = document.querySelector('.' + styles.serviceModeGrid).getBoundingClientRect();
        return { cards, grid:{left:grid.left,right:grid.right}, overflow:document.documentElement.scrollWidth > innerWidth };
      })()`);
      assert.equal(layout.overflow, false, `service-mode screen must not scroll sideways at ${width}px`);
      for (const card of layout.cards) assert.ok(card.left >= layout.grid.left && card.right <= layout.grid.right, `card stays in grid at ${width}px`);
      if (width > 460) assert.equal(layout.cards[0].top, layout.cards[1].top, "desktop keeps both service modes side by side");
      else assert.ok(layout.cards[1].top >= layout.cards[0].bottom, "narrow screen stacks service modes");
      await writeFile(path.join(output, `service-mode-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    console.log(`Restaurant service-mode empty state passed at desktop and mobile widths. Screenshots: ${output}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
