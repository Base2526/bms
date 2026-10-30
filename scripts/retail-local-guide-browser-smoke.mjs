// Real local Web/audio and real fixture login. No activation or backup mutations.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {localState,localClient,output} from './testing/retail-local-commercial-local.mjs';
const {chromium}=await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base='http://localhost:3011', local='http://localhost:3012';
const steps=JSON.parse(await readFile(new URL('../apps/web/components/retail-local/guide-flow.json',import.meta.url),'utf8'));
const state=await localState(), db=localClient(state);
await db.connect();
const original=(await db.query('SELECT tenant_id,language FROM users WHERE id=$1 AND fake_test=true',[state.adminId])).rows[0];
assert.ok(original);
const directory=path.join(output,'audio-guide');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
let groups=0;
async function mediaPlaying(page) {
  await page.waitForFunction(()=>{const a=document.querySelector('[data-retail-guide-player] audio');return a&&!a.paused&&a.currentTime>.05;});
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
}
async function aligned(guide,lang,index,{playing=false}={}) {
  const step=steps[index],copy=step[lang];
  assert.equal(await guide.locator('[data-guide-counter]').innerText(),`${index+1} / 12`);
  assert.equal(await guide.locator('[data-guide-title]').innerText(),`${index+1}. ${copy.title}`);
  assert.equal(await guide.locator('[data-guide-caption]').innerText(),copy.speech);
  assert.equal(await guide.locator('[data-guide-outcome]').innerText(),copy.outcome);
  assert.deepEqual(await guide.locator('[data-guide-step][aria-pressed=true]').evaluateAll(nodes=>nodes.map(n=>n.dataset.guideStep)),[step.id]);
  assert.deepEqual(await guide.locator('[data-guide-diagram] li').evaluateAll(nodes=>nodes.map(n=>[n.querySelector('strong').textContent,n.querySelector('small').textContent])),copy.nodes.map(n=>n.slice(1)));
  if(step.separateLast) {
    assert.equal(await guide.locator('[data-guide-diagram] li').nth(1).evaluate(n=>getComputedStyle(n,'::after').content),'none');
    assert.equal(await guide.locator('[data-guide-diagram] li').last().evaluate(n=>getComputedStyle(n).borderTopStyle),'dashed');
  }
  if(playing) {
    const actual=await guide.locator('audio').evaluate(a=>({path:new URL(a.currentSrc).pathname,paused:a.paused,duration:a.duration}));
    assert.equal(actual.path,step.audio);assert.equal(actual.paused,false);assert.ok(actual.duration>1);
  } else assert.ok(await guide.locator('audio').evaluate(a=>a.paused&&!a.getAttribute('src')));
}
async function allChapters(page,guide,lang) {
  // Every direct selection replaces the running clip, including stale callbacks from the old one.
  for(let i=0;i<steps.length;i++) {
    await guide.locator(`[data-guide-step="${steps[i].id}"]`).click();
    await aligned(guide,lang,i);
    await page.evaluate(()=>window.staleGuideEnded?.());
    await aligned(guide,lang,i);
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    await aligned(guide,lang,i,{playing:true});
    await page.evaluate(()=>window.staleGuideEnded=document.querySelector('[data-retail-guide-player] audio').onended);
  }
  await guide.locator('[data-guide-previous]').click();await aligned(guide,lang,10);
  await guide.locator('[data-guide-next]').click();await aligned(guide,lang,11);
  assert.ok(await guide.locator('[data-guide-next]').isDisabled());
  await guide.locator('[data-guide-all]').click();
  for(let i=0;i<steps.length;i++) {
    await page.waitForFunction(n=>document.querySelector('[data-guide-counter]').textContent===`${n} / 12`,i+1);
    await mediaPlaying(page);await aligned(guide,lang,i,{playing:true});
    // Seek the actual MP3; let the browser's real ended event advance the shared player.
    await guide.locator('audio').evaluate(a=>a.currentTime=a.duration-.1);
  }
  await page.waitForFunction(()=>{const a=document.querySelector('[data-retail-guide-player] audio');return a.paused&&!a.getAttribute('src');});
  await aligned(guide,lang,11);
  // The completed last chapter must replay from its own beginning.
  await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
  await aligned(guide,lang,11,{playing:true});
  assert.ok(await guide.locator('audio').evaluate(a=>a.currentTime<3));
  await guide.locator('[data-guide-step="prepare"]').click();await aligned(guide,lang,0);
}
try {
  for(const lang of ['th','en']) for(const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    context.setDefaultTimeout(20000);
    await context.addInitScript(()=>localStorage.setItem('pdpa_consent_v1',JSON.stringify({value:'reject',at:new Date().toISOString()})));
    await context.addCookies([{name:'lang',value:lang,url:base},{name:'theme',value:'light',url:base}]);
    await context.routeWebSocket('**/*',s=>s.close());
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    assert.equal((await page.goto(`${base}/${lang}/retail-local`)).status(),200);
    const consent=page.getByRole('button',{name:lang==='th'?/ใช้เฉพาะที่จำเป็น$/:/Necessary only$/});
    await consent.waitFor({timeout:3000}).catch(()=>{});
    if(await consent.isVisible()) await consent.click();
    const guide=page.locator('[data-retail-local-guide]');await guide.waitFor();
    assert.equal(await guide.locator('[data-guide-step]').count(),12);
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused&&!a.getAttribute('src')),'No audio on page load');
    assert.ok(await page.evaluate(()=>document.querySelector('#retail-local-guide').compareDocumentPosition(document.querySelector('#requirements'))&Node.DOCUMENT_POSITION_FOLLOWING));
    await allChapters(page,guide,lang);
    await guide.locator('[data-guide-step="prepare"]').click();
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    await guide.locator('audio').evaluate(a=>a.currentTime=5);
    await page.waitForFunction(()=>document.querySelector('[data-retail-guide-player] audio').currentTime>=5);
    await guide.locator('[data-guide-play]').click();
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused));
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    assert.ok(await guide.locator('audio').evaluate(a=>a.currentTime>=5),'Resume stays in the chapter');
    await guide.locator('[data-guide-rate]').selectOption('1.5');
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused));
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    assert.equal(await guide.locator('audio').evaluate(a=>a.playbackRate),1.5);
    await guide.locator('audio').evaluate(a=>a.currentTime=a.duration-.1);
    await page.waitForFunction(()=>document.querySelector('[data-guide-counter]').textContent==='2 / 12');
    await mediaPlaying(page);
    await guide.locator('[data-guide-play]').click();
    await guide.locator('[data-guide-step="prepare"]').click();
    await page.evaluate(()=>{window.realRetailPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('test blocked media','NotAllowedError'));};});
    await guide.locator('[data-guide-play]').click();
    await guide.locator('[data-guide-status]').filter({hasText:lang==='th'?'โหลดเสียงไม่ได้':'Audio could not load'}).waitFor();
    assert.equal(await guide.locator('[data-guide-counter]').innerText(),'1 / 12');
    await page.evaluate(()=>HTMLMediaElement.prototype.play=window.realRetailPlay);
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused));
    await page.evaluate(()=>delete document.hidden);
    // A missing shipped file also stops and allows retry without silently skipping chapters.
    await guide.locator('[data-guide-step="download"]').click();
    const broken='**/audio/retail-local/th/step-2.mp3';
    await context.route(broken,r=>r.fulfill({status:404,body:'missing fixture'}));
    await guide.locator('[data-guide-play]').click();
    await guide.locator('[data-guide-status]').filter({hasText:lang==='th'?'โหลดเสียงไม่ได้':'Audio could not load'}).waitFor();
    assert.equal(await guide.locator('[data-guide-counter]').innerText(),'2 / 12');
    await context.unroute(broken);
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    await guide.locator('[data-guide-play]').click();
    const summary=await context.request.get(`${base}/audio/retail-local/th/summary.mp3`);
    assert.equal(summary.status(),200);assert.ok((await summary.body()).length>1000);
    await page.goto(`${base}/${lang}/retail-local#retail-local-guide-backup-setup`);
    await page.waitForFunction(()=>document.querySelector('[data-guide-counter]')?.textContent==='8 / 12');
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused&&!a.getAttribute('src')));
    await noOverflow(page);
    await guide.screenshot({path:path.join(directory,`public-${lang}-${width}.png`)});
    await context.addCookies([{name:'theme',value:'dark',url:base}]);await page.reload();
    await guide.waitFor();await noOverflow(page);
    await guide.screenshot({path:path.join(directory,`public-${lang}-${width}-dark.png`)});
    assert.deepEqual(errors,[]);groups++;
    console.log(`PASS public ${lang}/${width}: 12 direct + 12 sequential audio/caption/diagram matches, stale callbacks, replay, resume/rate, errors/retry, themes`);
    await context.close();
  }

  // Temporarily bind only the synthetic platform user to the cloned local installation.
  const installation=(await db.query('SELECT tenant_id FROM bms_local_installation WHERE singleton=true')).rows[0];
  assert.ok(installation,'Restored Retail Local baseline required for the real admin route');
  for(const lang of ['th','en']) for(const width of [1280,390]) {
    await db.query('UPDATE users SET tenant_id=$1,language=$2 WHERE id=$3 AND fake_test=true',[installation.tenant_id,lang,state.adminId]);
    const context=await browser.newContext({viewport:{width,height:1000}});context.setDefaultTimeout(20000);
    await context.addInitScript(()=>localStorage.setItem('pdpa_consent_v1',JSON.stringify({value:'reject',at:new Date().toISOString()})));
    await context.addCookies([{name:'lang',value:lang,url:local}]);
    await context.routeWebSocket('**/*',s=>s.close());
    const login=await context.request.post(`${local}/api/graphql`,{data:{query:'mutation Login($input: LoginInput!) { loginAdmin(input: $input) { ok } }',variables:{input:{email:'retail-commercial-platform@example.invalid',password:state.userPassword}}}});
    assert.equal((await login.json()).data?.loginAdmin?.ok,true);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    assert.equal((await page.goto(`${local}/admin/retail-local-license?guide=backup-setup#backup`)).status(),200);
    const drawer=page.getByRole('dialog');const guide=drawer.locator('[data-retail-local-guide]');
    await guide.waitFor();assert.equal(await guide.locator('[data-guide-counter]').innerText(),'8 / 12');
    assert.ok(await guide.locator('audio').evaluate(a=>a.paused));
    await guide.locator('[data-guide-play]').click();await mediaPlaying(page);
    await page.evaluate(()=>window.closedGuideAudio=document.querySelector('[data-retail-guide-player] audio'));
    await drawer.locator('button.ant-drawer-close').click();
    await guide.waitFor({state:'hidden'});
    assert.ok(await page.evaluate(()=>window.closedGuideAudio.paused&&!window.closedGuideAudio.getAttribute('src')));
    await page.waitForURL(u=>!u.searchParams.has('guide'));
    // A client-side link from the already-mounted page must open the drawer again.
    await page.getByRole('link',{name:lang==='th'?'ฟังวิธี Backup / Restore':'Listen to backup / restore guidance',exact:true}).click();
    await guide.waitFor();assert.equal(await guide.locator('[data-guide-counter]').innerText(),'8 / 12');
    await drawer.locator('button.ant-drawer-close').click();await guide.waitFor({state:'hidden'});
    await page.getByRole('button',{name:lang==='th'?'ฟังวิธี Activate':'Listen: activation',exact:false}).click();
    await guide.waitFor();assert.equal(await guide.locator('[data-guide-counter]').innerText(),'6 / 12');
    await allChapters(page,guide,lang);
    await guide.locator('[data-guide-step="backup-setup"]').click();
    await page.waitForFunction(()=>{const panel=document.querySelector('.ant-drawer-content-wrapper');if(!panel)return false;const r=panel.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;});
    await noOverflow(page);await page.screenshot({path:path.join(directory,`admin-${lang}-${width}.png`),animations:'disabled'});
    await drawer.locator('button.ant-drawer-close').click();await guide.waitFor({state:'hidden'});
    await page.goto(`${local}/admin/manual`);await noOverflow(page);
    await page.getByText(lang==='th'?/มีปุ่มฟังวิธี Activate/:/Listen: activation and Listen: backup/).waitFor();
    assert.deepEqual(errors,[]);groups++;
    console.log(`PASS local admin ${lang}/${width}: 12 direct + 12 sequential audio/caption/diagram matches, actual login, links, drawer stop, manual`);
    await context.close();
  }
} finally {
  await db.query('UPDATE users SET tenant_id=$1,language=$2 WHERE id=$3 AND fake_test=true',[original.tenant_id,original.language,state.adminId]);
  await db.end();await browser.close();
  console.log(`${groups}/8 browser groups passed; synthetic user restored; no business mutations.`);
}
