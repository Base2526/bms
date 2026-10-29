import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium} = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BMS_SMOKE_URL || 'http://127.0.0.1:3112';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
await mkdir('.test-output/cost-pricing-browser',{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const lang of ['th','en']) for(const width of [1440,820,390]) {
    const context = await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    await context.addCookies([{name:'lang',value:lang,url:base},{name:'theme',value:'light',url:base}]);
    await context.addInitScript(()=>localStorage.setItem('pdpa_consent_v1',JSON.stringify({value:'reject',at:new Date().toISOString()})));
    let admin = false;
    await context.routeWebSocket('**/*',s=>s.close());
    await context.route('**/*',route=>{
      const url = new URL(route.request().url());
      if(url.origin !== new URL(base).origin) return route.abort();
      if(url.pathname==='/api/auth/me')return route.fulfill({json:admin?{isAuthenticated:true,admin:{id:'FAKE',name:'FAKE Manager',role:'Administrator',language:lang}}:{isAuthenticated:false,user:null,admin:null}});
      if(url.pathname.endsWith('/graphql'))return route.fulfill({json:{data:{myBmsPermissions:[]}}});
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
      return route.continue();
    });
    const page = await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    assert.equal((await page.goto(base+'/cost-pricing')).status(),200);
    const root=page.locator('[data-cost-pricing]');await root.waitFor();
    await root.locator('[data-session-cta][href="/shop-signup"]').waitFor();
    assert.ok((await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith('/cost-pricing'));
    assert.match(await root.locator('[data-cost-result="2"]').innerText(),/600/);
    await root.locator('[data-cost-input="2"]').fill('30');
    assert.equal(await root.locator('[data-cost-result="2"]').innerText(),'—');
    await root.locator('[data-cost-input="0"]').fill('');
    assert.equal(await root.locator('[data-cost-result="0"]').innerText(),'—');
    await root.locator('[data-cost-input="0"]').fill('2000');
    await root.locator('[data-cost-input="2"]').fill('65.10');
    await root.locator('[data-cost-input="3"]').fill('21060');
    assert.match(await root.locator('[data-cost-result="2"]').innerText(),/600/);
    assert.match(await root.locator('[data-cost-result="3"]').innerText(),/20/);
    await root.locator('[data-cost-input="2"]').fill('65.101');
    assert.equal(await root.locator('[data-cost-result="0"]').innerText(),'—');
    await root.locator('[data-cost-input="3"]').fill('21000');
    await root.locator('[data-cost-input="2"]').fill('65');
    for(let i=0;i<7;i++) { await root.locator(`[data-flow-step="${i}"]`).click();assert.equal(await root.locator('[data-step-counter]').innerText(),`${i+1} / 7`); }
    await root.locator('[data-flow-step="0"]').click();
    await root.locator('[data-play]').click();
    await page.waitForFunction(()=>{const a=document.querySelector('[data-cost-player] audio');return a&&!a.paused&&a.currentTime>0;});
    await root.locator('audio').evaluate(a=>{a.currentTime=a.duration-.1;});
    await page.waitForFunction(()=>document.querySelector('[data-step-counter]').textContent==='2 / 7');
    await root.locator('[data-play]').click();
    assert.ok(await root.locator('audio').evaluate(a=>a.paused));
    await root.locator('[data-play]').click();
    for(let active=2;active<=7;active++) {
      await page.waitForFunction(()=>{const a=document.querySelector('[data-cost-player] audio');return a&&!a.paused&&a.currentTime>0;});
      await root.locator('audio').evaluate(a=>{a.currentTime=a.duration-.1;});
      if(active<7) await page.waitForFunction(n=>document.querySelector('[data-step-counter]').textContent===`${n} / 7`,active+1);
      else await page.waitForFunction(()=>document.querySelector('[data-cost-player] audio').paused);
    }
    assert.equal(await root.locator('[data-step-counter]').innerText(),'7 / 7');
    await root.locator('[data-flow-step="0"]').click();
    const summary=await context.request.get(base+'/audio/cost-pricing/th/summary.mp3');
    assert.equal(summary.status(),200);assert.ok((await summary.body()).length>1000);
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`.test-output/cost-pricing-browser/${lang}-${width}.png`,fullPage:true});
    // Confirm a blocked media call reports an actionable failure and does not advance silently.
    await page.evaluate(()=>{window.savedCostPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('fixture','NotAllowedError'));};});
    await root.locator('[data-play]').click();
    await root.locator('[data-cost-player] [role="status"]').filter({hasText:lang==='th'?'โหลดเสียงไม่ได้':'Audio could not load'}).waitFor();
    await page.evaluate(()=>HTMLMediaElement.prototype.play=window.savedCostPlay);
    await root.locator('[data-play]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-cost-player] audio').paused);
    await page.goto(base+'/restaurant');
    await page.locator('[data-restaurant-guide] a[href="/cost-pricing"]').waitFor();
    admin=true;await page.goto(base+'/cost-pricing');
    await root.locator('[data-session-cta][href="/admin/dashboard"]').waitFor();
    await context.addCookies([{name:'theme',value:'dark',url:base}]);await page.reload();
    await root.waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`.test-output/cost-pricing-browser/${lang}-${width}-dark.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${lang}/${width}: exact decimal calculations, all 7 audio steps/end, pause, MP3, failure/retry, CTA, metadata, light/dark overflow`);
    await context.close();
  }
} finally {await browser.close();}
