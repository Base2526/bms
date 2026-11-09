import electronMain from "electron/main";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, BrowserWindow } = electronMain;
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");
const output = path.resolve(here, "../dist-smoke/restaurant-header");
const { build } = createRequire(path.join(web, "package.json"))("esbuild");

async function run() {
  await mkdir(output, { recursive: true });
  await build({
    stdin: {
      contents: [
        'import styles from "./app/(pos)/pos/restaurant/restaurant.module.css";',
        'import realtimeStyles from "./components/realtime/RealtimeProvider.module.css";',
        "window.styles = styles; window.realtimeStyles = realtimeStyles;",
      ].join("\n"),
      resolveDir: web,
      sourcefile: "restaurant-header-fixture.js",
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
    height: 760,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(output, "fixture.html"));
    await win.webContents.executeJavaScript(`(() => {
      const c = (...keys) => keys.map((key) => styles[key]).join(' ');
      const rt = (...keys) => keys.map((key) => realtimeStyles[key]).join(' ');
      const root = document.querySelector('#fixture');
      root.className = styles.page;
      root.innerHTML = \`
        <nav class="\${c('rail')}" aria-label="เมนู"><div class="\${c('railMark')}">B</div></nav>
        <div class="\${c('shell')}">
          <header class="\${c('topbar')}">
            <div class="\${c('brand')}"><div><h1 class="\${c('title')}">BMS Restaurant</h1><p class="\${c('subtitle')}">Shop B · POS-01</p></div></div>
            <div class="\${c('topActions')}">
              <div class="\${c('topStatusGroup')}">
                <div class="\${c('connectionStatus')}"><span class="\${rt('posConnection','posConnectionOffline')}" data-pos-connection="offline"><i class="\${rt('posConnectionDot')}"></i><span>ออฟไลน์</span></span></div>
                <span class="\${c('shiftStatus','shiftStatusOpen')}"><i></i>กะเปิดอยู่</span>
              </div>
              <button class="\${c('btn','incomingBell','incomingBellUnknown')}" aria-label="ตรวจสอบออร์เดอร์เข้าไม่ได้">♧<span>ออร์เดอร์</span><b class="\${c('incomingBellBadge','incomingBellHealthBadge')}">!</b></button>
              <button class="\${c('btn','btnIcon')}" aria-label="รีเฟรช">↻</button>
              <button class="\${c('btn','btnIcon')}" aria-label="ช่วยเหลือ">♬</button>
              <details class="\${c('accountMenu')}">
                <summary aria-label="ผู้ปฏิบัติงาน Sakesan Sung-ngoen"><span class="\${c('accountAvatar')}">S</span><span class="\${c('accountCopy')}"><strong>Sakesan Sung-ngoen</strong><small>กำลังปฏิบัติงาน</small></span><span class="\${c('accountChevron')}">⌄</span></summary>
              </details>
            </div>
          </header>
          <section class="\${c('otherWorkWorkspace')}">
            <div class="\${c('otherWorkToolbar')}">
              <span class="\${c('incomingWorkspaceMark')}">♧</span>
              <div><h2>ออร์เดอร์เดลิเวอรีและรับเอง</h2><p>รับหรือปฏิเสธ ส่งเข้าครัว แจ้งพร้อม และส่งมอบจากหน้าจอนี้</p></div>
              <span class="\${c('incomingIntakeStatus','incomingIntakeUnknown')}">ตรวจสถานะรับออร์เดอร์ไม่ได้</span>
            </div>
            <main style="flex:1;background:var(--ground);display:grid;place-items:center;color:var(--ink-3)">ข้อมูลไม่เป็นปัจจุบัน · กดโหลดใหม่</main>
          </section>
        </div>\`;
    })()`);

    for (const [width, height] of [[1280, 760], [390, 844]]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
      const layout = await win.webContents.executeJavaScript(`(() => {
        const topbar = document.querySelector('.' + styles.topbar).getBoundingClientRect();
        const actions = [...document.querySelectorAll('.' + styles.topActions + ' > *')].map((node) => {
          const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom };
        });
        const accountCopy = getComputedStyle(document.querySelector('.' + styles.accountCopy)).display;
        const healthBadge = document.querySelector('.' + styles.incomingBellHealthBadge);
        const intake = document.querySelector('.' + styles.incomingIntakeUnknown).getBoundingClientRect();
        return { topbar:{left:topbar.left,right:topbar.right,height:topbar.height}, actions, accountCopy,
          healthBadge:healthBadge?.textContent, intake:{left:intake.left,right:intake.right},
          overflow: document.documentElement.scrollWidth > innerWidth };
      })()`);
      assert.equal(layout.overflow, false, `compact restaurant header must not scroll sideways at ${width}px`);
      assert.equal(layout.accountCopy, "none", "operator name stays in the accessible menu instead of consuming header width");
      assert.equal(layout.healthBadge, "!", "failed incoming feed shows an unknown-state badge instead of a zero count");
      assert.ok(layout.intake.left >= 0 && layout.intake.right <= width, `unknown intake status stays visible at ${width}px`);
      for (const action of layout.actions) {
        assert.ok(action.left >= layout.topbar.left && action.right <= layout.topbar.right,
          `every compact header action stays inside the topbar at ${width}px`);
      }
      if (width >= 900) assert.ok(layout.topbar.height <= 68, `desktop header stays compact (found ${layout.topbar.height}px)`);
      await writeFile(path.join(output, `restaurant-header-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    console.log(`Restaurant compact header passed at desktop and mobile widths. Screenshots: ${output}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => { console.error(error); app.exit(1); });
