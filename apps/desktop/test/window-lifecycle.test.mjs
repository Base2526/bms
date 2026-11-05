import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function body(name) {
  const start=source.indexOf(`function ${name}(`);
  assert.ok(start>=0);
  return (source.slice(start-6,start)==='async ' ? 'async ' : '')+source.slice(start,source.indexOf('\n}\n',start)+3);
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
for(const paired of [true,false]) test(`reopening the cashier works with a surviving utility window (paired=${paired})`,()=>{
  const calls=[],window={isDestroyed:()=>false};
  const context=vm.createContext({mainWindow:null,activePairing:paired?{}:null,app:{isReady:()=>true},
    BrowserWindow:{getAllWindows:()=>[{}]},createMainWindow:()=>{calls.push('create');return window;},
    startPosNavigation:()=>calls.push('pos'),restoreSavedPairing:()=>calls.push('restore')});
  vm.runInContext(`${body('reopenMainWindow')};reopenMainWindow();`,context);
  assert.equal(context.mainWindow,window);
  assert.deepEqual(calls,['create',paired?'pos':'restore']);
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
for(const fail of [true,false]) test(`a late server probe cannot replace a newer setup screen (failure=${fail})`,async()=>{
  const screens=[];let finish,startedResolve;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const context=vm.createContext({mainWindow:{isDestroyed:()=>false},activePairing:{serverUrl:'https://old.example'},startupNavigation:null,pairingRevision:0,
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
  const context=vm.createContext({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
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

test('a slow disk restore cannot replace a newer pairing',async()=>{
  const read=deferred(),screens=[];
  const newer={serverUrl:'https://new.example',token:'FAKE-new'};
  const context=vm.createContext({mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
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
  const context=vm.createContext({mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
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
  const context=vm.createContext({mainWindow:{isDestroyed:()=>false},activePairing:null,pairingRestoreError:null,
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
  const context=vm.createContext({mainWindow:window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isStartupFrame:()=>true,isPairedPosFrame:()=>true,removePairing:async()=>result,
    showSetup:async target=>{setup=target;screens.push('setup');}});
  vm.runInContext(`${body('registerIpc')};registerIpc();`,context);
  assert.equal((await handlers.get('bms-pos:change-server')({})).ok,false);assert.deepEqual(screens,[]);
  result={ok:true};assert.equal((await handlers.get('bms-pos:unpair')({})).ok,true);assert.equal(setup,window);
});

test('failed removal preserves the live pairing and returns an actionable failure',async()=>{
  const pairing={serverUrl:'https://shop.example',token:'FAKE'},failure=deferred();
  let reconciled=0;
  const context=vm.createContext({activePairing:pairing,pairingRestoreError:null,pairingInProgress:false,
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
  const context=vm.createContext({mainWindow:window,activePairing:null,pendingUnpair:null,
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},
    isPairedPosFrame:()=>true,removePairing:async()=>({ok:true}),
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
  const context=vm.createContext({activePairing:pairing,mainWindow:{isDestroyed:()=>false},pairingRevision:0,
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
  const context=vm.createContext({activePairing:{},mainWindow:null,customerDisplayConfig:{mode:'auto'},
    offerCustomerDisplaySetup:()=>{},closeCustomerDisplayWindow:()=>closed++,broadcastCustomerDisplayState:()=>{},
    screen:{getAllDisplays:()=>[{},{}]},cashierDisplay:()=>({id:1}),selectCustomerDisplay:()=>({id:2}),
    createCustomerDisplayWindow:()=>created++});
  vm.runInContext(`${body('reconcileCustomerDisplay')};reconcileCustomerDisplay();`,context);
  assert.equal(created,0);assert.equal(closed,1);
});
