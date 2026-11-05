import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const ts=require('typescript');
const read=(path:string)=>readFileSync(new URL(`../apps/web/${path}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

test('the desktop bridge requires explicit removal success and surfaces failures without clearing browser storage',async()=>{
  const window:any={bmsDesktop:{unpair:async()=>({ok:true})},localStorage:{removeItem:()=>assert.fail('native credentials are not browser storage')}};
  const exports:any={};new Function('window','exports',compile(read('lib/pos/deviceTokenClient.ts')))(window,exports);
  for(const result of [{ok:false,error:'Cannot remove'},null,undefined]) {
    window.bmsDesktop.unpair=async()=>result;
    await assert.rejects(exports.clearPosDeviceToken(),result?.error ? /Cannot remove/ : /เลิกจับคู่เครื่องไม่สำเร็จ/);
  }
  window.bmsDesktop.unpair=async()=>{throw Error('private OS detail');};
  await assert.rejects(exports.clearPosDeviceToken(),e=>String(e).includes('เลิกจับคู่เครื่องไม่สำเร็จ')&&!String(e).includes('private'));
  window.bmsDesktop.unpair=async()=>({ok:true});await exports.clearPosDeviceToken();
  const sequence:string[]=[];
  window.bmsDesktop.unpair=async(afterRemoval:()=>void)=>{
    sequence.push('removed');afterRemoval();sequence.push('navigate');return {ok:true};
  };
  await exports.clearPosDeviceToken(()=>sequence.push('cleanup'));
  assert.deepEqual(sequence,['removed','cleanup','navigate'],'cleanup runs once before native navigation');
});

for(const surface of ['retail','restaurant','compact']) test(`${surface} preserves the operator and draft until unpair is confirmed`,async()=>{
  const path=surface==='compact'?'components/pos-desktop/DesktopPosRenderer.tsx':surface==='retail'?'app/(pos)/pos/page.tsx':'app/(pos)/pos/restaurant/page.tsx';
  const source=read(path);
  let fn;
  if(surface==='compact') {
    const start=source.indexOf('const unpair = useCallback(async () => {')+'const unpair = useCallback(async () => {'.length;
    fn=`async function unpair(){${source.slice(start,source.indexOf('\n  }, [',start))}\n}`;
  } else {
    const name=surface==='retail'?'unpair':'unpairFromSettings';
    const start=source.indexOf(`  async function ${name}() {`);
    fn=source.slice(start,source.indexOf('\n  }',start)+4)+`\nconst unpairHandler=${name};`;
  }
  const actions:string[]=[],errors:string[]=[];
  let reject=false,resolve:(()=>void)|null=null;
  const deps:any={embedded:false,onUnpair:null,deviceStorageNamespace:'device',token:'FAKE',
    paymentNavigationBlocked:()=>false,posDeviceStorageNamespace:async()=> 'device',
    clearPosDeviceToken:async(afterRemoval:()=>void)=>{if(reject)throw Error('Cannot remove');await new Promise<void>(done=>{resolve=done;});actions.push('removed');afterRemoval();},
    window:{bmsDesktop:{},localStorage:{removeItem:()=>actions.push('draft')}},
    router:{replace:()=>actions.push('navigate')},
    setError:(text:string)=>errors.push(text),setNotice:({text}:{text:string})=>errors.push(text),
    LOCAL_TAB_KEY_PREFIX:'tab',LOCAL_CART_DRAFT_KEY_PREFIX:'cart',LOCAL_SCREEN_KEY_PREFIX:'screen',LOCAL_CHECK_KEY_PREFIX:'check',
  };
  for(const name of ['setToken','setDeviceStorageNamespace','setTokenInput','setSession','setTokenRejected','setSessionError','clearOperator',
    'setActorUserId','setActorPin','clearPreparedWorkspaces','setBootstrap','setCashier','setVerifiedLogin','setLoginPhase','setPin',
    'setCatalog','setCatalogLoading','setCatalogError','setBoardGameCheckout','clearScannedProduct','setServiceCalls','sendFlow']) deps[name]=()=>actions.push(name);
  for(const name of ['catalogRequestVersion','catalogRequestRef','catalogPrimedRef','catalogLoadErrorRef','tokenRef']) deps[name]={current:0};
  const handler=new Function(...Object.keys(deps),`${compile(fn)}\nreturn ${surface==='compact'?'unpair':'unpairHandler'};`)(...Object.values(deps));
  reject=true;await handler();assert.deepEqual(actions,[]);assert.deepEqual(errors,['Cannot remove']);
  reject=false;const pending=handler();await Promise.resolve();
  assert.deepEqual(actions,[]);assert.ok(resolve);resolve();await pending;
  assert.equal(actions[0],'removed');assert.ok(actions.includes('setToken'));
});
