import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
test('Opted-in direct HTTP shares the loopback app and uses its canonical Steam callback',async()=>{
 const reserves=[net.createServer(),net.createServer()];
 for(const s of reserves)await new Promise(r=>s.listen(0,'127.0.0.1',r));
 const [port,directPort]=reserves.map(s=>s.address().port);
 for(const s of reserves)await new Promise(r=>s.close(r));
 const dir=await mkdtemp(path.join(os.tmpdir(),'hymm-direct-'));
 const publicOrigin=`http://203.0.113.10:${directPort}`,local=`http://127.0.0.1:${port}`,direct=`http://127.0.0.1:${directPort}`;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),stdio:'ignore',env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,PUBLIC_ORIGIN:publicOrigin,PUBLIC_HTTP_TEST_PORT:String(directPort),ALLOW_INSECURE_HTTP_TEST:'1',ENABLE_RANKED:'1',ENABLE_DEMO:'0',TRUST_LOCAL_PROXY:'0'}});
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(direct+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready);
  assert.deepEqual(await (await fetch(local+'/health')).json(),{ok:true});
  assert.deepEqual((await (await fetch(direct+'/api/state')).json()).config,{demo:false,ranked:true,steam:true});
  const auth=await fetch(direct+'/auth/steam',{redirect:'manual'}),steam=new URL(auth.headers.get('location'));
  assert.equal(steam.protocol,'https:');assert.equal(steam.hostname,'steamcommunity.com');
  assert.equal(new URL(steam.searchParams.get('openid.return_to')).origin,publicOrigin);
  assert.match(auth.headers.get('set-cookie'),/HttpOnly/);assert.doesNotMatch(auth.headers.get('set-cookie'),/; Secure/);
  assert.equal((await fetch(direct+'/.env')).status,404);
  assert.equal((await fetch(direct+'/api/admin/state')).status,403);
  assert.equal((await fetch(direct+'/api/bridge/jobs')).status,401);
  assert.equal((await fetch(direct+'/api/action',{method:'POST',headers:{Origin:publicOrigin,'Content-Type':'application/json'},body:'{"type":"join"}'})).status,403);
 }finally{
  if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()});
  await rm(dir,{recursive:true,force:true});
 }
});
