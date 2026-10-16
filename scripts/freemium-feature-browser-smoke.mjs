import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.BMS_SMOKE_URL || 'http://localhost:3007';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const output='.test-output/freemium-feature-browser';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const lang of ['th','en']) for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    await context.addCookies([{name:'ADMIN_COOKIE',value:'FAKE-browser-fixture',url:base},{name:'lang',value:lang,url:base}]);
    let mode='locked', lastRefresh, saveCount=0;
    const errors=[];
    await context.route(/\/(?:api\/|graphql)/,async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/auth/me')return route.fulfill({json:{isAuthenticated:true,admin:{id:1,role:'Administrator',email:'fake@example.test',language:lang}}});
      if(!['/graphql','/api/graphql'].includes(path))return route.fulfill({json:{}});
      const {query:q,variables}=route.request().postDataJSON();
      if(q.includes('mutation')) {
        if(q.includes('bmsRefreshRetention')){lastRefresh=variables.existingOnly;return route.fulfill({json:{data:{bmsRefreshRetention:0}}});}
        if(q.includes('bmsUpsertReportSubscription')){saveCount++;return route.fulfill({json:{data:{bmsUpsertReportSubscription:{enabled:false,lastStatus:null}}}});}
        throw Error('unexpected mutation in mock-only test');
      }
      const legacy=mode==='legacy', paid=['paid','read-only','no-permission'].includes(mode), existing=mode==='existing';
      const data={
        myBmsPermissions:['retention.view','retention.manage','billing.view','settings.manage',
          ...(mode==='no-permission'?[]:['report.view']),...(mode==='read-only'||mode==='no-permission'?[]:['report.email'])],bmsIsPlatformAdmin:false,
        bmsFeatureAccess:[{feature:'REPORT_SCHEDULE',minimumPlan:'pro',allowed:legacy||paid||existing,source:legacy?'LEGACY':paid?'PLAN':existing?'EXISTING_WORK':'LOCKED'},
          {feature:'RETENTION_ENGINE',minimumPlan:'business',allowed:legacy||paid,source:legacy?'LEGACY':paid?'PLAN':'LOCKED'}],
        bmsMyTenant:{id:'FAKE',name:'FAKE Shop',slug:'fake'},bmsChannels:[],bmsChannelHealth:[],
        bmsReportSubscription:{frequency:'DAILY',sendHour:8,sendWeekday:null,sendDayOfMonth:null,emailEnabled:false,recipientEmail:null,slackEnabled:false,hasSlackWebhook:false,lineEnabled:false,lineUserId:null,enabled:false,lastSentAt:null,lastStatus:null,lastPeriodKey:null},
        bmsReportDeliveries:[],bmsRetentionCases:[],bmsRetentionAnalytics:{treatmentTotal:0,holdoutTotal:0,treatmentConverted:0,holdoutConverted:0,treatmentRate:0,holdoutRate:0,incrementalLift:0,retentionRevenue:0},
        bmsStoreProfile:{businessArchetype:'retail'},bmsKitchenBoardEnabled:false,bmsWastageEnabled:false,bmsPackToolsConfigured:false,
        bmsActingTenant:null,bmsChannelHealthCount:0,bmsInboxUnreadCount:0,bmsMyMentionsUnreadCount:0,bmsRestockReadyCount:0,
        bmsMe:{id:'1',email:'fake@example.test',tenant:{id:'FAKE',slug:'fake'}},bmsAiConfig:{has_key:false,api_key_masked:null,model:'claude-haiku-4-5',provider:'anthropic'},
        bmsAiUsage:{billingMode:'PLAN_POINTS',count:0,limit:100,remaining:100,unlimited:false,planCode:'free',planName:'Free',creditStatus:'NORMAL',resetsAt:'2026-10-31T17:00:00Z'},
        bmsAiLimitNotifications:{unreadCount:0,items:[]},
      };
      return route.fulfill({json:{data}});
    });
    const page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',e=>errors.push(e.message));
    const checkLayout=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'no horizontal page overflow');
    try {
      for(const state of ['locked','legacy','existing','paid']) {
        mode=state;
        await page.goto(`${base}/admin/settings`,{waitUntil:'domcontentloaded'});
        await page.getByRole('tab').filter({hasText:lang==='th'?'รายงานสรุปยอดขาย':'Sales digest reports'}).click();
        const save=page.locator('.ant-tabs-tabpane-active form button[type="submit"]');
        await save.waitFor();
        // Wait for the server-derived access result rather than a loading placeholder.
        if(state==='paid') await page.waitForFunction(()=>document.querySelector('.ant-tabs-tabpane-active form button[type="submit"]')?.disabled===false);
        else await page.getByTestId('feature-access-REPORT_SCHEDULE').waitFor();
        assert.equal(await save.isDisabled(),state==='locked');
        if(state!=='locked'){const before=saveCount;const response=page.waitForResponse(r=>r.request().postData()?.includes('bmsUpsertReportSubscription'));await save.click();await response;assert.ok(saveCount>before);}
        await checkLayout();
        await page.screenshot({path:`${output}/reports-${state}-${lang}-${width}.png`,fullPage:true});
        await page.goto(`${base}/admin/followup-queue`,{waitUntil:'domcontentloaded'});
        const canGenerate=['legacy','paid'].includes(state);
        const button=page.getByRole('button',{name:canGenerate?(lang==='th'?'อัปเดต Retention intelligence':'Refresh retention intelligence'):(lang==='th'?'อัปเดตเฉพาะเคสเดิม':'Update existing cases only'),exact:true});
        await button.waitFor();
        lastRefresh=undefined;
        const refreshResponse=page.waitForResponse(r=>r.request().postData()?.includes('bmsRefreshRetention'));
        await button.click();
        await refreshResponse;
        assert.equal(lastRefresh,!canGenerate,'locked shops request maintenance only');
        await checkLayout();
        await page.screenshot({path:`${output}/retention-${state}-${lang}-${width}.png`,fullPage:true});
      }
      for(const state of ['read-only','no-permission']) {
        mode=state;
        await page.goto(`${base}/admin/settings`,{waitUntil:'domcontentloaded'});
        await page.getByRole('tab').filter({hasText:lang==='th'?'รายงานสรุปยอดขาย':'Sales digest reports'}).click();
        if(state==='read-only') {
          await page.getByText(lang==='th'?'ดูได้อย่างเดียว:':'Read only:',{exact:false}).waitFor();
          assert.equal(await page.locator('.ant-tabs-tabpane-active form button[type="submit"]').isDisabled(),true);
        } else {
          await page.getByText(lang==='th'?'ต้องมีสิทธิ์ดูรายงาน (report.view)':'Report viewing permission is required (report.view).',{exact:true}).waitFor();
          assert.equal(await page.locator('.ant-tabs-tabpane-active form').count(),0);
        }
        await checkLayout();
        await page.screenshot({path:`${output}/reports-${state}-${lang}-${width}.png`,fullPage:true});
      }
      assert.deepEqual(errors,[]);
    } catch(error) {
      await page.screenshot({path:`${output}/failure-${lang}-${width}.png`,fullPage:true});
      console.log((await page.locator('body').innerText()).slice(-5000),errors);throw error;
    } finally {await context.close();}
  }
  console.log('PASS phase two: locked/legacy/existing-work/paid, Thai/English, desktop/mobile; mocked APIs only');
} finally {await browser.close();}
