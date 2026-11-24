import desktopLocale from '../renderer/locale.cjs';
const { posText } = desktopLocale;
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { MAX_QUEUE_DISPLAYS, normalizeCustomerDisplayConfig, normalizeQueueDisplayConfig,
  queueClaimsCustomerDisplay, selectQueueDisplays } from '../src/display-policy.mjs';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function body(name) {
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0);
  return (source.slice(start-6,start)==='async ' ? 'async ' : '')+source.slice(start,source.indexOf('\n}\n',start)+3);
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
for(const paired of [true,false]) test(`reopening the cashier works with a surviving utility window (paired=${paired})`,()=>{
  const calls=[],window={isDestroyed:()=>false};
  const context=vm.createContext({posText,mainWindow:null,activePairing:paired?{}:null,
    pendingRefreshRequest:null,startupNavigation:null,mainLoadRecovery:null,app:{isReady:()=>true},
    BrowserWindow:{getAllWindows:()=>[{}]},createMainWindow:()=>{calls.push('create');return window;},
    startPosNavigation:()=>calls.push('pos'),restoreSavedPairing:()=>calls.push('restore')});
  vm.runInContext(`${body('reopenMainWindow')};reopenMainWindow();`,context);
  assert.equal(context.mainWindow,window);
  assert.deepEqual(calls,['create',paired?'pos':'restore']);
});
test('reopening a destroyed cashier does not inherit its unfinished navigation or refresh',()=>{
  const calls=[];
  const oldWindow={isDestroyed:()=>true};
  const newWindow={isDestroyed:()=>false};
  const timer=setTimeout(()=>assert.fail('stale refresh timer fired'),1000);
  const context=vm.createContext({mainWindow:oldWindow,activePairing:{},app:{isReady:()=>true},
    pendingRefreshRequest:{timer},startupNavigation:Promise.resolve(),mainLoadRecovery:Promise.resolve(),
    clearTimeout,createMainWindow:()=>newWindow,
    startPosNavigation:()=>{calls.push('pos');assert.equal(context.startupNavigation,null);
      assert.equal(context.mainLoadRecovery,null);assert.equal(context.pendingRefreshRequest,null);},
    restoreSavedPairing:()=>assert.fail('pairing is already active')});
  vm.runInContext(`${body('reopenMainWindow')};reopenMainWindow();`,context);
  assert.equal(context.mainWindow,newWindow);
  assert.deepEqual(calls,['pos']);
});
test('late close of an old cashier leaves the replacement display windows open',()=>{
  const calls=[];
  const oldWindow={};const newWindow={};
  const context=vm.createContext({mainWindow:newWindow,pendingRefreshRequest:null,pendingUnpair:null,
    startupNavigation:null,mainLoadRecovery:null,clearTimeout,
    closeCustomerDisplayWindow:()=>calls.push('customer'),
    closeQueueDisplayWindow:()=>calls.push('queue'),
    closePosPopupWindows:()=>calls.push('popups')});
  vm.runInContext(body('handleMainWindowClosed'),context);
  context.handleMainWindowClosed(oldWindow);
  assert.equal(context.mainWindow,newWindow);
  assert.deepEqual(calls,[]);
  context.handleMainWindowClosed(newWindow);
  assert.equal(context.mainWindow,null);
  assert.deepEqual(calls,['customer','queue','popups']);
});
test('cashier-opened /pos popups close with the cashier and on unpair, and only once',async()=>{
  const popup=(name)=>{const w={name,closed:0,destroyed:false,listeners:{},
    isDestroyed:()=>w.destroyed,close:()=>{w.closed++;w.destroyed=true;w.listeners.closed?.();},
    once:(event,fn)=>{w.listeners[event]=fn;}};return w;};
  const make=()=>vm.createContext({posPopupWindows:new Set(),mainWindow:null,pendingRefreshRequest:null,
    pendingUnpair:null,startupNavigation:null,mainLoadRecovery:null,clearTimeout,
    closeCustomerDisplayWindow:()=>{},closeQueueDisplayWindow:()=>{}});
  const closing=make();
  vm.runInContext(`${body('trackPosPopupWindow')};${body('closePosPopupWindows')};${body('handleMainWindowClosed')}`,closing);
  const cashier={},manual=popup('manual'),board=popup('board'),gone=popup('gone');
  closing.mainWindow=cashier;
  for(const w of [manual,board,gone]) closing.trackPosPopupWindow(w);
  gone.close();
  assert.equal(closing.posPopupWindows.size,2,'a popup closed by the user leaves the set');
  closing.handleMainWindowClosed(cashier);
  assert.deepEqual([manual.closed,board.closed,gone.closed],[1,1,1]);
  assert.equal(closing.posPopupWindows.size,0);

  const unpairPopup=popup('manual');
  const unpairing=vm.createContext({posText,activePairing:{serverUrl:'https://shop.example',token:'FAKE'},
    pairingRestoreError:null,pairingInProgress:false,pairingRevision:0,pairingRestoreRequest:0,
    startupNavigation:null,pendingRefreshRequest:null,posPopupWindows:new Set(),
    installApplicationMenu:()=>{},closeCustomerDisplayWindow:()=>{},clearTimeout,
    pairingPersistence:()=>({remove:async()=>{}})});
  vm.runInContext(`${body('trackPosPopupWindow')};${body('closePosPopupWindows')}`,unpairing);
  unpairing.trackPosPopupWindow(unpairPopup);
  const result=await vm.runInContext(`${body('removePairing')};removePairing();`,unpairing);
  assert.equal(result.ok,true);
  assert.equal(unpairPopup.closed,1,'a popup must not keep running on the removed pairing');
});
test('second launch and macOS activation restore/focus the existing minimized cashier',()=>{
  const calls=[];
  vm.runInNewContext(`${body('reopenMainWindow')};reopenMainWindow();`,{
    app:{isReady:()=>true},mainWindow:{isDestroyed:()=>false,isMinimized:()=>true,
      restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')},
    createMainWindow:()=>assert.fail('must reuse the cashier'),
  });
  assert.deepEqual(calls,['restore','show','focus']);
  assert.match(source,/app\.on\("second-instance", reopenMainWindow\)/);
  assert.match(source,/app\.on\("activate", reopenMainWindow\)/);
});
test('a failed cashier reload shows local recovery without clearing pairing',async()=>{
  const screens=[];const paired={serverUrl:'https://shop.example'};
  const window={isDestroyed:()=>false};
  const context=vm.createContext({URL,posText,mainWindow:window,activePairing:paired,
    startupNavigation:null,mainLoadRecovery:null,isPosPath:pathname=>pathname.startsWith('/pos/'),
    showStartup:async(state,message,target)=>screens.push({state,message,target}),
    console:{error:()=>assert.fail('recovery should load')}});
  vm.runInContext(`${body('handleMainPosLoadFailure')};handleMainPosLoadFailure(mainWindow,-106,'https://shop.example/pos/app',true);`,context);
  await context.mainLoadRecovery;
  assert.equal(screens.length,1);
  assert.equal(screens[0].state,'error');
  assert.equal(screens[0].target,window);
  assert.match(screens[0].message,/เชื่อมต่อหน้าขายไม่สำเร็จ/);
  assert.equal(context.activePairing,paired);
  assert.match(source,/webContents\.on\("did-fail-load"[\s\S]*?handleMainPosLoadFailure\(window, errorCode, failedUrl, isMainFrame\)/);
});
test('failed subresources, cancelled or stale navigations never replace the cashier',()=>{
  const screens=[];const window={isDestroyed:()=>false};
  const context=vm.createContext({URL,posText,mainWindow:window,activePairing:{serverUrl:'https://shop.example'},
    startupNavigation:null,mainLoadRecovery:null,isPosPath:pathname=>pathname.startsWith('/pos/'),
    showStartup:async state=>screens.push(state),console:{error:()=>{}}});
  vm.runInContext(body('handleMainPosLoadFailure'),context);
  const fail=(code,url,main=true,target=window)=>context.handleMainPosLoadFailure(target,code,url,main);
  fail(-106,'https://shop.example/pos/app',false);
  fail(-3,'https://shop.example/pos/app');
  fail(-106,'https://other.example/pos/app');
  fail(-106,'https://shop.example/admin');
  context.startupNavigation=Promise.resolve();fail(-106,'https://shop.example/pos/app');context.startupNavigation=null;
  fail(-106,'https://shop.example/pos/app',true,{isDestroyed:()=>false});
  assert.deepEqual(screens,[]);
});
test('main POS HTTP 5xx recovers even when Chromium completes the navigation',async()=>{
  const screens=[];const window={webContents:{id:41},isDestroyed:()=>false};
  const context=vm.createContext({URL,posText,mainWindow:window,activePairing:{serverUrl:'https://shop.example'},
    startupNavigation:Promise.resolve(),mainLoadRecovery:null,
    isPosPath:pathname=>pathname.startsWith('/pos/'),
    showStartup:async(state,message,target)=>screens.push({state,message,target}),
    console:{error:()=>assert.fail('recovery should load')}});
  vm.runInContext(`${body('handleMainPosLoadFailure')};${body('handleMainPosHttpResponse')}`,context);
  const response=(statusCode,resourceType='mainFrame',webContentsId=41,url='https://shop.example/pos/app')=>
    context.handleMainPosHttpResponse(window,{statusCode,resourceType,webContentsId,url});
  response(503,'script');response(503,'mainFrame',42);response(200);response(503,'mainFrame',41,'https://other.example/pos/app');
  assert.deepEqual(screens,[]);
  response(503);
  await context.mainLoadRecovery;
  assert.equal(screens.length,1);
  assert.equal(screens[0].state,'error');
  assert.equal(screens[0].target,window);
  assert.match(screens[0].message,/HTTP 503/);
  assert.match(source,/webRequest\.onCompleted\(\{ urls: \["<all_urls>"\] \}, \(details\) => \{\s+handleMainPosHttpResponse\(window, details\)/);
});
test('Retry waits for an in-flight failed navigation and keeps the saved pairing',async()=>{
  const pending=deferred();let navigations=0;
  const pairing={serverUrl:'https://shop.example'};
  const window={isDestroyed:()=>false,webContents:{getURL:()=>`file:///app/startup.html?state=error`}};
  const context=vm.createContext({mainWindow:window,activePairing:pairing,pairingRevision:4,
    startupNavigation:pending.promise,mainLoadRecovery:null,STARTUP_FILE:'/app/startup.html',
    fileURLToPath:value=>new URL(value).pathname,startPosNavigation:()=>{navigations++;}});
  vm.runInContext(`${body('retryStartupFromRecovery')};retryStartupFromRecovery();`,context);
  assert.equal(navigations,0);
  pending.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(navigations,1);
  assert.equal(context.activePairing,pairing);
  assert.match(source,/ipcMain\.handle\("bms-pos:retry-startup"[\s\S]*?retryStartupFromRecovery\(\)/);
});
for(const changed of ['screen','pairing','window']) test(`a queued Retry cannot interrupt a newer ${changed}`,async()=>{
  const pending=deferred();let navigations=0,url='file:///app/startup.html?state=error';
  const window={isDestroyed:()=>false,webContents:{getURL:()=>url}};
  const context=vm.createContext({mainWindow:window,activePairing:{serverUrl:'https://shop.example'},
    pairingRevision:4,startupNavigation:pending.promise,mainLoadRecovery:null,
    STARTUP_FILE:'/app/startup.html',fileURLToPath:value=>new URL(value).pathname,
    startPosNavigation:()=>{navigations++;}});
  vm.runInContext(`${body('retryStartupFromRecovery')};retryStartupFromRecovery();`,context);
  if(changed==='screen') url='https://shop.example/pos/app';
  if(changed==='pairing') context.pairingRevision++;
  if(changed==='window') context.mainWindow={isDestroyed:()=>false};
  pending.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(navigations,0);
});
for(const fail of [true,false]) test(`a late server probe cannot replace a newer setup screen (failure=${fail})`,async()=>{
  const screens=[];let finish,startedResolve;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const context=vm.createContext({posText,mainWindow:{isDestroyed:()=>false},activePairing:{serverUrl:'https://old.example'},startupNavigation:null,pairingRevision:0,
    showStartup:async(state)=>screens.push(state),
    ensurePairingServerAvailable:()=>new Promise((resolve,reject)=>{finish=()=>fail?reject(Error('offline')):resolve();startedResolve();}),
    showPos:()=>assert.fail('old pairing must not navigate'),reconcileCustomerDisplay:()=>{},console:{error:()=>{}}});
  const operation=vm.runInContext(`${body('startPosNavigation')};startPosNavigation();`,context);
  await started;
  context.activePairing=null;finish();await operation;
  assert.deepEqual(screens,['loading']);
});
test('a pairing verification cannot write after the setup frame changes; simultaneous requests are bounded',async()=>{
  const handlers=new Map();let finish,setup=true,writes=0;
  const context=vm.createContext({posText,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    pairingInProgress:false,pairingRevision:0,pairingRestoreRequest:0,isSetupFrame:()=>setup,currentSecureStorageStatus:()=>({ok:true}),
    parsePairingInput:()=>({ok:true,serverUrl:'https://shop.example',token:'FAKE'}),
    verifyPairing:()=>new Promise(resolve=>{finish=resolve;}),writePairing:()=>{writes++;},
    installApplicationMenu:()=>{},startPosNavigation:()=>{}});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  const pair=handlers.get('bms-pos:pair');
  const pending=pair({},{});
  assert.equal((await pair({},{})).ok,false);
  setup=false;finish({ok:true});
  assert.equal((await pending).ok,false);assert.equal(writes,0);assert.equal(context.pairingInProgress,false);
});

test('pairing carries frame validity into the disk commit and never navigates after closure', async () => {
  const handlers=new Map(), saving=deferred(), entered=deferred();
  let setup=true, guard, navigations=0;
  const context=vm.createContext({posText,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    pairingInProgress:false,pairingRevision:0,pairingRestoreRequest:0,activePairing:null,
    isSetupFrame:()=>setup,currentSecureStorageStatus:()=>({ok:true}),
    parsePairingInput:()=>({ok:true,serverUrl:'https://shop.example',token:'FAKE'}),
    verifyPairing:async()=>({ok:true}),writePairing:(_pairing,current)=>{guard=current;entered.resolve();return saving.promise;},
    installApplicationMenu:()=>{},startPosNavigation:()=>{navigations++;}});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  const pending=handlers.get('bms-pos:pair')({},{});
  await entered.promise;
  assert.equal(guard(),true);
  setup=false;
  assert.equal(guard(),false);
  // Simulate a rename already committed while the original setup window closed.
  saving.resolve();
  assert.equal((await pending).ok,true);
  assert.equal(navigations,0);
  assert.equal(context.activePairing,null);
  assert.equal(context.pairingInProgress,false);
});

test('a slow disk restore cannot replace a newer pairing',async()=>{
  const read=deferred(),screens=[];
  const newer={serverUrl:'https://new.example',token:'FAKE-new'};
  const context=vm.createContext({posText,mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
    pairingRevision:0,pairingRestoreRequest:0,pairingRestoreTask:null,
    configPath:()=>'',decryptedToken:()=>'',readSavedPairing:()=>read.promise,
    pairingPersistence:()=>({read:()=>read.promise}),installApplicationMenu:()=>{},
    startPosNavigation:()=>screens.push('pos'),showSetup:()=>screens.push('setup'),showStartup:()=>screens.push('recovery')});
  const restore=vm.runInContext(`${body('readPairing')};${body('restoreSavedPairing')};restoreSavedPairing();`,context);
  context.pairingRevision++;
  context.activePairing=newer;
  read.resolve({serverUrl:'https://old.example',token:'FAKE-old'});
  await restore;
  assert.equal(context.activePairing,newer);
  assert.deepEqual(screens,[]);
});

test('reopening during installer verification shares the handoff and restores only the newest window',async()=>{
  const handoff=deferred(),entered=deferred();let reads=0,consumed=0;
  const screens=[],pairing={serverUrl:'https://shop.example',token:'FAKE'};
  const context=vm.createContext({posText,mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
    pairingRevision:0,pairingRestoreRequest:0,pairingRestoreTask:null,
    readPairing:async()=>{reads++;return {pairing:null,error:null};},
    consumePairingHandoff:()=>{consumed++;entered.resolve();return handoff.promise;},
    installApplicationMenu:()=>{},startPosNavigation:()=>screens.push(context.mainWindow),showSetup:()=>assert.fail('must restore handoff')});
  vm.runInContext(body('restoreSavedPairing'),context);
  const first=context.restoreSavedPairing();await entered.promise;
  const newWindow={isDestroyed:()=>false};context.mainWindow=newWindow;
  const second=context.restoreSavedPairing();
  handoff.resolve(pairing);await Promise.all([first,second]);
  assert.equal(reads,1);assert.equal(consumed,1);assert.equal(context.activePairing,pairing);
  assert.deepEqual(screens,[newWindow]);
});

test('a stale failed disk read cannot replace a newer recovery outcome',async()=>{
  const old=deferred(),screens=[],pairing={serverUrl:'https://new.example',token:'FAKE'};
  const context=vm.createContext({posText,mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
    pairingRevision:0,pairingRestoreRequest:0,pairingRestoreTask:null,
    readPairing:()=>old.promise,showStartup:()=>screens.push('error'),installApplicationMenu:()=>{}});
  vm.runInContext(body('restoreSavedPairing'),context);
  const restoring=context.restoreSavedPairing();
  context.pairingRevision++;context.activePairing=pairing;
  old.resolve({pairing:null,error:{userMessage:'locked'}});await restoring;
  assert.equal(context.activePairing,pairing);assert.equal(context.pairingRestoreError,null);assert.deepEqual(screens,[]);
});

test('change-server denial does not navigate and successful removal targets its original window',async()=>{
  const handlers=new Map(),window={},screens=[];let result={ok:false,error:'Cannot remove'},setup;
  const context=vm.createContext({posText,mainWindow:window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isStartupFrame:()=>true,isPairedCashierFrame:()=>true,removePairing:async()=>result,
    showSetup:async target=>{setup=target;screens.push('setup');}});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  assert.equal((await handlers.get('bms-pos:change-server')({})).ok,false);assert.deepEqual(screens,[]);
  result={ok:true};assert.equal((await handlers.get('bms-pos:unpair')({})).ok,true);assert.equal(setup,window);
});

test('failed removal preserves the live pairing and returns an actionable failure',async()=>{
  const pairing={serverUrl:'https://shop.example',token:'FAKE'},failure=deferred();
  let reconciled=0;
  const context=vm.createContext({posText,activePairing:pairing,pairingRestoreError:null,pairingInProgress:false,
    pairingRevision:0,pairingRestoreRequest:0,startupNavigation:null,pendingRefreshRequest:null,
    installApplicationMenu:()=>{},closeCustomerDisplayWindow:()=>{},clearTimeout,
    scheduleCustomerDisplayReconcile:()=>reconciled++,
    pairingPersistence:()=>({remove:()=>failure.promise})});
  const removing=vm.runInContext(`${body('removePairing')};removePairing();`,context);
  failure.reject(Error('EACCES'));
  const result=await removing;
  assert.equal(result.ok,false);assert.ok(result.error);
  assert.equal(context.activePairing,pairing);
  assert.equal(reconciled,1);
});

for (const replaced of [false,true]) test(`unpair navigation requires its initiating frame and never replaces a new window (replaced=${replaced})`,async()=>{
  const handlers=new Map(),frame={},window={webContents:{},isDestroyed:()=>false};
  let timeout,navigated=0;
  const context=vm.createContext({posText,mainWindow:window,activePairing:null,pendingUnpair:null,
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isPairedCashierFrame:()=>true,removePairing:async()=>({ok:true}),
    setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{},console,
    showSetup:async()=>{navigated++;}});
  vm.runInContext(`${body('finishUnpairNavigation')};${body('registerIpc')};registerIpc();`,context);
  const event={sender:window.webContents,senderFrame:frame};
  assert.equal((await handlers.get('bms-pos:unpair')(event,{deferSetup:true})).ok,true);
  assert.equal(navigated,0,'successful removal must wait for renderer cleanup');
  assert.equal((await handlers.get('bms-pos:complete-unpair')({...event,senderFrame:{}})).ok,false);
  assert.equal(navigated,0);
  if(replaced) {context.mainWindow={};timeout();}
  else assert.equal((await handlers.get('bms-pos:complete-unpair')(event)).ok,true);
  assert.equal(navigated,replaced?0:1);
  assert.equal(context.pendingUnpair,null);
});

test('a stale macOS local probe cannot reopen startup or start the old runtime after unpair',async()=>{
  const pending=deferred(),screens=[],started=[];let probes=0;
  const pairing={serverUrl:'http://127.0.0.1:3100'};
  const context=vm.createContext({posText,activePairing:pairing,mainWindow:{isDestroyed:()=>false},pairingRevision:0,
    probePairingServer:()=>++probes===1?pending.promise:Promise.resolve(),isManagedLocalServerUrl:()=>true,process:{platform:'darwin'},
    canRecoverByStartingManagedLocalRuntime:()=>true,showStartup:()=>screens.push('starting'),
    startManagedLocalRuntime:()=>started.push('runtime')});
  const ensuring=vm.runInContext(`${body('ensurePairingServerAvailable')};ensurePairingServerAvailable(activePairing);`,context);
  context.activePairing=null;context.pairingRevision++;
  pending.reject(Error('offline'));await ensuring;
  assert.deepEqual(screens,[]);assert.deepEqual(started,[]);
});

test('display hotplug after closing the cashier does not resurrect a customer window',()=>{
  let created=0,closed=0;
  const context=vm.createContext({posText,activePairing:{},mainWindow:null,customerDisplayConfig:{mode:'auto'},
    offerCustomerDisplaySetup:()=>{},closeCustomerDisplayWindow:()=>closed++,broadcastCustomerDisplayState:()=>{},
    screen:{getAllDisplays:()=>[{},{}]},cashierDisplay:()=>({id:1}),selectCustomerDisplay:()=>({id:2}),
    createCustomerDisplayWindow:()=>created++});
  vm.runInContext(`${body('reconcileCustomerDisplay')};reconcileCustomerDisplay();`,context);
  assert.equal(created,0);assert.equal(closed,1);
});

test('only the cashier main frame can control displays, attention or unpair', async () => {
  const frame = {url:'https://shop.example/pos/app'};
  const sender = {mainFrame:frame};
  const window = {webContents:sender,isDestroyed:()=>false};
  const handlers = new Map();
  let removed=0;
  const context=vm.createContext({posText,URL,mainWindow:window,activePairing:{serverUrl:'https://shop.example'},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    removePairing:async()=>{removed++;return {ok:false};}});
  vm.runInContext(`${body('isPosPath')};${body('isPairedPosFrame')};${body('isPairedCashierFrame')};${body('registerIpc')};registerIpc();`,context);
  const event={sender,senderFrame:frame};
  assert.equal(context.isPairedCashierFrame(event),true);
  for (const denied of [{sender:{mainFrame:frame},senderFrame:frame},
    {sender,senderFrame:{...frame}}, {sender,senderFrame:{url:'https://other.example/pos'}}]) {
    assert.equal(context.isPairedCashierFrame(denied),false);
    assert.equal((await handlers.get('bms-pos:unpair')(denied)).ok,false);
  }
  for (const route of ['manual','queue-board','display']) {
    frame.url=`https://shop.example/pos/${route}`;
    assert.equal(context.isPairedCashierFrame(event),false);
    assert.equal((await handlers.get('bms-pos:unpair')(event)).ok,false);
  }
  assert.equal(removed,0);
});

test('utility windows cannot navigate or redirect into another register, origin or local file',()=>{
  const handlers=new Map();let popup;
  const context=vm.createContext({posText,URL,activePairing:{serverUrl:'https://shop.example'}});
  vm.runInContext(body('secureUtilityWindow'),context);
  context.secureUtilityWindow({webContents:{on:(name,fn)=>handlers.set(name,fn),setWindowOpenHandler:fn=>{popup=fn;}}},'https://shop.example/pos/queue-board');
  for(const kind of ['will-navigate','will-redirect']) {
    for(const url of ['https://shop.example/pos/app','https://shop.example/admin','https://other.example/pos/queue-board','file:///setup.html']) {
      let prevented=false;
      handlers.get(kind)({preventDefault:()=>{prevented=true;}},url);
      assert.equal(prevented,true,url);
    }
    handlers.get(kind)({preventDefault:()=>assert.fail('same utility route allowed')},'https://shop.example/pos/queue-board?desktop=1');
  }
  assert.equal(popup().action,'deny');
});

test('managed display retries a failed page load and stops after closing or unpairing',async()=>{
  const pending=[];const closed=[];let attempts=0,current=true,destroyed=false;
  const window={webContents:{id:42},isDestroyed:()=>destroyed,on:(name,handler)=>{if(name==='closed')closed.push(handler);},
    loadURL:()=>{attempts++;return attempts===1?Promise.reject(Error('offline')):Promise.resolve();}};
  const context=vm.createContext({posText,setTimeout:(handler)=>{pending.push(handler);return pending.length;},
    clearTimeout:()=>{},window,isCurrent:()=>current,utilityHttpRetries:new Map()});
  vm.runInContext(`${body('loadUtilityWithRetry')};loadUtilityWithRetry(window,'https://shop.example/pos/queue-board',isCurrent);`,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,1);
  assert.equal(pending.length,1);
  pending.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,2);

  window.loadURL=()=>{attempts++;return Promise.reject(Error('offline again'));};
  context.loadUtilityWithRetry(window,'https://shop.example/pos/queue-board',context.isCurrent);
  await new Promise(resolve=>setImmediate(resolve));
  current=false;
  pending.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,3,'unpairing prevents another request');
  current=true;
  context.loadUtilityWithRetry(window,'https://shop.example/pos/queue-board',context.isCurrent);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,4);
  destroyed=true;for(const handler of closed)handler();
  pending.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,4,'closed windows do not retry');
});

test('managed display retries only its own HTTP 5xx page',async()=>{
  const timers=[];let attempts=0;
  const window={webContents:{id:42},isDestroyed:()=>false,on:()=>{},
    loadURL:()=>{attempts++;return Promise.resolve();}};
  const context=vm.createContext({URL,utilityHttpRetries:new Map(),window,
    setTimeout:(handler)=>{timers.push(handler);return timers.length;},clearTimeout:()=>{}});
  vm.runInContext(`${body('loadUtilityWithRetry')};${body('handleUtilityHttpResponse')}`,context);
  context.loadUtilityWithRetry(window,'https://shop.example/pos/display',()=>true);
  const response=(statusCode,resourceType='mainFrame',webContentsId=42,url='https://shop.example/pos/display')=>
    context.handleUtilityHttpResponse({statusCode,resourceType,webContentsId,url});
  response(503,'script');response(200);response(503,'mainFrame',99);
  response(503,'mainFrame',42,'https://shop.example/pos/app');
  response(503,'mainFrame',42,'https://other.example/pos/display');
  assert.equal(timers.length,0);
  response(503);response(503);
  assert.equal(timers.length,1,'two failed responses schedule one retry');
  timers.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(attempts,2);
  assert.match(source,/handleMainPosHttpResponse\(window, details\);\s+handleUtilityHttpResponse\(details\)/);
});

test('display configuration writes exclude overlapping legacy and combined controls and release on failure',async()=>{
  const handlers=new Map(),gate=deferred();let writes=0;
  const context=vm.createContext({posText,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isPairedCashierFrame:()=>true,managedDisplayOperationBusy:false,
    normalizeCustomerDisplayConfig,normalizeQueueDisplayConfig,
    customerDisplayConfig:{mode:'off'},queueDisplayConfig:{mode:'off'},
    writeQueueDisplayConfig:()=>{writes++;return gate.promise;},closeQueuePreviewWindow:()=>{},
    reconcileQueueDisplay:()=>{},currentQueueDisplayState:()=>({})});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  const save=handlers.get('bms-pos:set-queue-display-config');
  const first=save({}, {mode:'auto'});
  for(const name of ['set-queue-display-config','set-queue-displays-config','set-customer-display-config','set-external-display-role']) {
    assert.equal((await handlers.get(`bms-pos:${name}`)({}, {mode:'off',role:'queue'})).ok,false);
  }
  assert.equal(writes,1);
  gate.resolve();assert.equal((await first).ok,true);
  context.writeQueueDisplayConfig=async()=>{throw Error('disk full');};
  assert.equal((await save({}, {mode:'off'})).ok,false);
  assert.equal(context.managedDisplayOperationBusy,false);
  assert.equal(context.queueDisplayConfig.mode,'auto');
});

test('queue reconciliation opens three independent windows, closes only a removed monitor, and preserves preview',()=>{
  const displays=[{id:10},{id:20},{id:30},{id:40}];
  const windows=new Map();const opened=[],closed=[];
  const preview={isDestroyed:()=>false};
  const context=vm.createContext({activePairing:{},mainWindow:{isDestroyed:()=>false},
    queueDisplayConfig:normalizeQueueDisplayConfig({mode:'auto',displayCount:3}),
    queueDisplayWindows:windows,queuePreviewWindow:preview,screen:{getAllDisplays:()=>displays},
    cashierDisplay:()=>displays[0],customerDisplayTargetId:()=>null,selectQueueDisplays,
    createQueueDisplayWindow:(display)=>{if (!windows.has(String(display.id))) {
      opened.push(display.id);windows.set(String(display.id),{isDestroyed:()=>false});}},
    closeManagedQueueDisplayWindow:(id)=>{closed.push(id);windows.delete(id);},
    closeQueueDisplayWindow:()=>assert.fail('pairing remains active'),broadcastQueueDisplayState:()=>{}});
  vm.runInContext(body('reconcileQueueDisplay'),context);
  context.reconcileQueueDisplay();
  assert.deepEqual(opened,[20,30,40]);assert.deepEqual(closed,[]);
  displays.splice(2,1);
  context.reconcileQueueDisplay();
  assert.deepEqual(closed,['30']);assert.equal(context.queuePreviewWindow,preview);
  displays.splice(2,0,{id:30});
  context.reconcileQueueDisplay();
  assert.deepEqual(opened,[20,30,40,30]);
  context.queueDisplayConfig=normalizeQueueDisplayConfig({mode:'off'});
  context.reconcileQueueDisplay();
  assert.deepEqual([...windows.keys()],[]);assert.equal(context.queuePreviewWindow,preview);
});

test('queue state chooses one deterministic audio owner and keeps missing selected screens visible',()=>{
  const displays=[{id:10},{id:20},{id:30}];
  const windows=new Map([['30',{isDestroyed:()=>false}],['20',{isDestroyed:()=>false}]]);
  const context=vm.createContext({posText,MAX_QUEUE_DISPLAYS,queueDisplayWindows:windows,queuePreviewWindow:null,
    queueDisplayConfig:normalizeQueueDisplayConfig({mode:'selected',targetDisplayIds:['20','30','40'],audioDisplayId:'30'}),
    screen:{getAllDisplays:()=>displays},cashierDisplay:()=>displays[0],
    customerDisplayTargetId:()=>null,selectQueueDisplays,
    displaySummary:(display,index)=>({id:String(display.id),label:`Screen ${index+1}`}),isWaylandSession:()=>false});
  vm.runInContext(body('currentQueueDisplayState'),context);
  const initial=context.currentQueueDisplayState();
  assert.equal(initial.audioDisplayId,'30');
  assert.equal(initial.screens.filter((screen)=>screen.audio).length,1);
  assert.equal(initial.screens.find((screen)=>screen.id==='40').connected,false);
  windows.delete('30');
  const fallback=context.currentQueueDisplayState();
  assert.equal(fallback.audioDisplayId,'20');
  assert.equal(fallback.screens.find((screen)=>screen.id==='20').audio,true);
});

test('multi-queue IPC rejects invalid assignments and atomically releases a conflicting customer screen',async()=>{
  const handlers=new Map(),writes=[];let authorized=true;
  const screens=[{id:10},{id:20},{id:30},{id:40}];
  const context=vm.createContext({posText,MAX_QUEUE_DISPLAYS,
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isPairedCashierFrame:()=>authorized,managedDisplayOperationBusy:false,
    normalizeCustomerDisplayConfig,normalizeQueueDisplayConfig,queueClaimsCustomerDisplay,selectQueueDisplays,
    customerDisplayConfig:normalizeCustomerDisplayConfig({mode:'selected',targetDisplayId:'20'}),
    queueDisplayConfig:normalizeQueueDisplayConfig({mode:'off'}),
    screen:{getAllDisplays:()=>screens},cashierDisplay:()=>screens[0],
    customerDisplayTargetId:()=>context.customerDisplayConfig.mode === 'off' ? null : '20',
    writeManagedDisplayConfigs:async(...args)=>writes.push(args),
    reconcileCustomerDisplay:()=>{},reconcileQueueDisplay:()=>{},
    currentManagedDisplayState:()=>({})});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  const save=handlers.get('bms-pos:set-queue-displays-config');
  const base={mode:'selected',displayCount:2,targetDisplayIds:['20','30'],audioDisplayId:'30'};
  authorized=false;
  assert.equal((await save({},base)).ok,false);
  authorized=true;
  for(const input of [
    {...base,targetDisplayIds:['20','20']},
    {...base,targetDisplayIds:['10']},
    {...base,targetDisplayIds:['20','30','40','50']},
    {...base,targetDisplayIds:['99']},
    {...base,audioDisplayId:'40'},
    {...base,mode:'auto',displayCount:4,targetDisplayIds:[]},
  ]) assert.equal((await save({},input)).ok,false);
  assert.equal(writes.length,0);
  assert.equal((await save({},base)).ok,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0][0].mode,'off');
  assert.deepEqual(context.queueDisplayConfig.targetDisplayIds,['20','30']);
  assert.equal(context.queueDisplayConfig.audioDisplayId,'30');
  assert.equal(context.customerDisplayConfig.mode,'off');
  screens.splice(2);
  context.customerDisplayConfig=normalizeCustomerDisplayConfig({mode:'auto'});
  assert.equal((await save({}, {mode:'auto',displayCount:1,targetDisplayIds:[],audioDisplayId:null})).ok,true);
  assert.equal(writes[1][0].mode,'off','auto queue setup hands off the only external screen');
  context.queueDisplayConfig=normalizeQueueDisplayConfig({mode:'auto',displayCount:2,audioDisplayId:'30'});
  assert.equal((await save({}, {mode:'auto',displayCount:2,targetDisplayIds:[],audioDisplayId:'30'})).ok,true,
    'retry keeps a saved audio screen that is temporarily disconnected');
  assert.equal((await save({}, {mode:'auto',displayCount:2,targetDisplayIds:[],audioDisplayId:'40'})).ok,false,
    'an unrelated disconnected screen cannot become the audio owner');
  screens.push({id:30},{id:40},{id:50});
  assert.equal((await save({}, {mode:'auto',displayCount:4,targetDisplayIds:[],audioDisplayId:null})).ok,true,
    'four connected external monitors can be requested');
  assert.equal((await save({}, {mode:'selected',displayCount:4,
    targetDisplayIds:['20','30','40','50'],audioDisplayId:'50'})).ok,true,
    'four connected external monitors can be selected with one audio owner');
});

test('queue window presentation is read-only, frame-scoped and assigns audio to one managed window',()=>{
  const managedA={isDestroyed:()=>false,webContents:{}};
  const managedB={isDestroyed:()=>false,webContents:{}};
  const preview={isDestroyed:()=>false,webContents:{}};
  const context=vm.createContext({URL,queueDisplayWindows:new Map([['20',managedA],['30',managedB]]),
    queuePreviewWindow:preview,isPairedPosFrame:()=>true,
    currentQueueDisplayState:()=>({audioDisplayId:'30'})});
  vm.runInContext(body('queueWindowPresentationForEvent'),context);
  const request=(sender,url='https://shop.example/pos/queue-board',subframe=false)=>{
    const frame={url};sender.mainFrame=subframe?{}:frame;
    return context.queueWindowPresentationForEvent({sender,senderFrame:frame});
  };
  assert.deepEqual({...request(managedA.webContents)}, {displayId:'20',audioEnabled:false,preview:false});
  assert.deepEqual({...request(managedB.webContents)}, {displayId:'30',audioEnabled:true,preview:false});
  assert.deepEqual({...request(preview.webContents)}, {displayId:null,audioEnabled:false,preview:true});
  assert.equal(request(managedB.webContents,'https://shop.example/pos/app'),null);
  assert.equal(request(managedB.webContents,'https://shop.example/pos/queue-board',true),null);
  context.isPairedPosFrame=()=>false;
  assert.equal(request(managedB.webContents),null);
});

test('assigning a customer monitor releases only that monitor from a three-screen queue',async()=>{
  const handlers=new Map(),writes=[];
  const screens=[{id:10},{id:20},{id:30},{id:40}];
  const context=vm.createContext({posText,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isPairedCashierFrame:()=>true,managedDisplayOperationBusy:false,
    normalizeCustomerDisplayConfig,normalizeQueueDisplayConfig,selectQueueDisplays,
    selectCustomerDisplay:(all,cashier,config)=>all.find((display)=>String(display.id)===config.targetDisplayId),
    customerDisplayConfig:normalizeCustomerDisplayConfig({mode:'off'}),
    queueDisplayConfig:normalizeQueueDisplayConfig({mode:'selected',targetDisplayIds:['20','30','40'],audioDisplayId:'30'}),
    screen:{getAllDisplays:()=>screens},cashierDisplay:()=>screens[0],
    writeManagedDisplayConfigs:async(...args)=>writes.push(args),customerDisplayWindowKind:null,
    closeQueuePreviewWindow:()=>{},reconcileCustomerDisplay:()=>{},reconcileQueueDisplay:()=>{},
    currentManagedDisplayState:()=>({})});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  const result=await handlers.get('bms-pos:set-external-display-role')({},
    {role:'customer',mode:'selected',targetDisplayId:'30'});
  assert.equal(result.ok,true);assert.equal(writes.length,1);
  assert.deepEqual(context.queueDisplayConfig.targetDisplayIds,['20','40']);
  assert.equal(context.queueDisplayConfig.audioDisplayId,null);
  assert.equal(context.customerDisplayConfig.targetDisplayId,'30');
});

test('kitchen journal serializes late writes and continues after a disk error',async()=>{
  const gate=deferred(),started=deferred(),writes=[];
  let renames=0;
  const context=vm.createContext({posText,kitchenJournalWrite:Promise.resolve(),kitchenPrintJournal:{},
    kitchenPrintJournalPath:()=>'/fixture/journal',
    writeFile:async(_path,data)=>{writes.push(JSON.parse(data));if(writes.length===1){started.resolve();await gate.promise;}},
    rename:async()=>{if(++renames===1)throw Error('rename failed');}});
  vm.runInContext(body('saveKitchenJournalEntry'),context);
  const first=context.saveKitchenJournalEntry('one',{status:'PRINTING',at:'1'});
  const failed=assert.rejects(first,/rename failed/);
  await started.promise;
  const second=context.saveKitchenJournalEntry('two',{status:'PRINTING',at:'2'});
  assert.equal(writes.length,1);
  gate.resolve();await failed;await second;
  assert.equal(writes.length,2);
  assert.equal(writes[1].one.status,'PRINTING');
  assert.equal(writes[1].two.status,'PRINTING');
});
