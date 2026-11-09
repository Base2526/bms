import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const output = path.resolve(here, "../dist-smoke/restaurant-kitchen");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");

async function run() {
  await mkdir(output, { recursive: true });
  await build({
    stdin: {
      contents: 'import styles from "./app/(pos)/pos/restaurant/restaurant.module.css"; window.styles = styles;',
      resolveDir: web,
      sourcefile: "restaurant-kitchen-fixture.js",
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
    height: 900,
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
        <section class="\${c('kitchenBoard')}">
          <div class="\${c('kitchenBar')}">
            <button class="\${c('kitchenFilter','kitchenFilterOn')}">ทั้งหมด 12</button>
            <button class="\${c('kitchenFilter')}">ครัวร้อน 5</button>
            <button class="\${c('kitchenFilter')}">บาร์ 3</button>
            <div class="\${c('kitchenBarEnd')}"><span class="\${c('kitchenLive')}">อัปเดตล่าสุด</span></div>
          </div>
          <section class="\${c('kitchenPickupBar')}" aria-label="คิวกลับบ้าน">
            <strong class="\${c('kitchenPickupTitle')}">คิวกลับบ้าน</strong>
            <div class="\${c('kitchenPickupList')}">
              <div class="\${c('kitchenPickupItem')}"><b>046</b><span>เข้าใหม่ · 1:08</span></div>
              <div class="\${c('kitchenPickupItem')}"><b>044</b><span>กำลังทำ · 3:21</span></div>
              <div class="\${c('kitchenPickupItem','kitchenPickupReady')}"><b>042</b><span>พร้อมเสิร์ฟ · 0:18</span></div>
              <div class="\${c('kitchenPickupItem')}"><b>041</b><span>กำลังทำ · 4:06</span></div>
            </div>
          </section>
          <div class="\${c('lanes')}">
            \${['เข้าใหม่','กำลังทำ','พร้อมเสิร์ฟ','เสิร์ฟแล้ว'].map((label, lane) => \`
              <section class="\${c('lane')}" style="--lane-color: \${['#d25332','#a96f09','#187356','#68736d'][lane]}">
                <div class="\${c('laneHead')}"><strong>\${label}</strong><span class="\${c('laneCount')}">\${lane + 1}</span></div>
                <div class="\${c('laneScroll')}">
                  <article class="\${c('ticket')}">
                    <div class="\${c('ticketHead')}">
                      <span class="\${c('ticketTable')}">กลับบ้าน</span>
                      <span class="\${c('ticketQueueBadge')}">คิว 04\${lane + 2}</span>
                      <span class="\${c('tag')}">ครัวร้อน</span>
                      <span class="\${c('ticketAge')}">3:21</span>
                    </div>
                    <div class="\${c('ticketLine')}"><span class="\${c('ticketQty')}">2×</span><span class="\${c('ticketDish')}">ข้าวเหนียวมะม่วง · สูตรต้นตำรับ</span></div>
                    <div class="\${c('ticketActions')}"><button class="\${c('btn','btnPrimary','ticketGo')}">พร้อมเสิร์ฟ →</button></div>
                  </article>
                </div>
              </section>\`).join('')}
          </div>
        </section>\`;
    })()`);

    for (const [width, height] of [[1280, 900], [420, 820]]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
      const layout = await win.webContents.executeJavaScript(`(() => {
        const bar = document.querySelector('[aria-label="คิวกลับบ้าน"]');
        const title = bar.querySelector('strong');
        const list = bar.querySelector('div');
        const ticket = document.querySelector('article');
        const badge = ticket.querySelector('.' + styles.ticketQueueBadge);
        const box = (node) => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
        return { bar:box(bar), title:box(title), list:box(list), ticket:box(ticket), badge:box(badge),
          listClientWidth:list.clientWidth, listScrollWidth:list.scrollWidth,
          documentOverflow:document.documentElement.scrollWidth > innerWidth };
      })()`);
      assert.equal(layout.documentOverflow, false, `document must not scroll sideways at ${width}px`);
      assert.ok(layout.badge.left >= layout.ticket.left && layout.badge.right <= layout.ticket.right, `queue badge stays inside its ticket at ${width}px`);
      assert.ok(layout.list.left >= layout.bar.left && layout.list.right <= layout.bar.right, `quick queue list stays inside its bar at ${width}px`);
      if (width <= 640) assert.ok(layout.list.top >= layout.title.bottom, "mobile stacks the queue title above its scroll rail");
      await writeFile(path.join(output, `kitchen-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    console.log(`Restaurant kitchen quick strip passed at desktop and mobile widths. Screenshots: ${output}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
