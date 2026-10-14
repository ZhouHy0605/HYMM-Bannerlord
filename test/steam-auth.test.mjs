import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createSteamRequest} from '../steam-network.mjs';

test('Steam transport rejects untrusted destinations and malformed proxies',()=>{
 assert.throws(()=>createSteamRequest('socks5://127.0.0.1:7897'));
 assert.throws(()=>createSteamRequest('http://user:secret@127.0.0.1:7897'));
 const request=createSteamRequest();
 for(const u of ['http://steamcommunity.com/','https://steamcommunity.com.evil.test/','https://api.steampowered.com:8443/'])assert.throws(()=>request(u));
});

test('Steam callback verifies assertion, creates persistent session/profile, rejects tampering and replay',async()=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://127.0.0.1:${port}`,dir=await mkdtemp(path.join(os.tmpdir(),'arena-steam-test-'));
 let child;const env={...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,DATA_DIR:dir,STEAM_HTTP_PROXY:'',STEAM_WEB_API_KEY:'test-key',ENABLE_RANKED:'0',ADMIN_STEAM_IDS:'76561198000000001'};
 const start=async()=>{child=spawn(process.execPath,['--import','./test/steam-preload.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env,stdio:'ignore'});for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server did not start');};
 const stop=()=>new Promise(r=>{child.once('exit',r);child.kill();});
 const login=async(nonce=new Date().toISOString().replace(/\.\d{3}Z$/,'Z')+Math.random())=>{
  const r=await fetch(origin+'/auth/steam',{redirect:'manual'}),auth=new URL(r.headers.get('location')),callback=new URL(auth.searchParams.get('openid.return_to'));
  const cookie=r.headers.get('set-cookie').split(';')[0];
  const values={ns:'http://specs.openid.net/auth/2.0',mode:'id_res',op_endpoint:'https://steamcommunity.com/openid/login',claimed_id:'https://steamcommunity.com/openid/id/76561198000000001',identity:'https://steamcommunity.com/openid/id/76561198000000001',return_to:callback.href,response_nonce:nonce,assoc_handle:'test',signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',sig:'test-valid'};
  for(const [k,v]of Object.entries(values))callback.searchParams.set('openid.'+k,v);
  return {callback,cookie,nonce};
 };
 const callback=({callback,cookie})=>fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});
 try{
  await start();const flow=await login(),r=await callback(flow);assert.equal(r.headers.get('location'),'/');
  const session=r.headers.getSetCookie().find(c=>c.startsWith('arena='))?.split(';')[0];assert.ok(session);
  const state=async()=>(await fetch(origin+'/api/state',{headers:{Cookie:session}})).json();
  let s=await state();assert.equal(s.mode,'ranked');assert.equal(s.me.id,'76561198000000001');assert.equal(s.me.name,'测试骑士');assert.equal(s.me.avatar,'https://avatars.steamstatic.com/test.jpg');assert.equal(s.isAdmin,true);assert.equal(s.me.rating,1000);assert.equal(s.leaderboard.length,1);
  assert.equal((await fetch(origin+'/api/admin/state')).status,403);
  assert.equal((await fetch(origin+'/api/admin/state',{headers:{Cookie:session}})).status,200);
  assert.equal((await fetch(origin+'/api/admin/action',{method:'POST',headers:{Cookie:session,Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+'/api/admin/action',{method:'POST',headers:{Cookie:session,Origin:'https://evil.example','X-CSRF-Token':s.csrf,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.match((await callback(flow)).headers.get('location'),/authError=/);
  const replay=await login(flow.nonce);assert.match((await callback(replay)).headers.get('location'),/authError=/);
  const tampered=await login();tampered.callback.searchParams.set('openid.return_to',origin+'/wrong');assert.match((await callback(tampered)).headers.get('location'),/authError=/);
  const rejected=await login();rejected.callback.searchParams.set('openid.sig','invalid');const bad=await callback(rejected);assert.match(bad.headers.get('location'),/authError=/);assert.ok(!bad.headers.get('set-cookie')?.includes('arena='));
  await stop();env.ADMIN_STEAM_IDS='';await start();s=await state();assert.equal(s.me.id,'76561198000000001');assert.equal(s.config.ranked,false);assert.equal(s.isAdmin,false);assert.equal(s.me.rating,undefined);assert.equal(s.me.rank,undefined);assert.deepEqual(s.leaderboard,[]);assert.deepEqual(s.ledger,[]);assert.equal(s.users[s.me.id].rating,undefined);assert.ok(s.me.combat);const guest=await (await fetch(origin+'/api/state')).json();assert.equal(guest.users[s.me.id].rating,undefined);assert.equal((await fetch(origin+'/api/admin/state',{headers:{Cookie:session}})).status,403);
 }finally{if(child&&!child.killed)await stop();await rm(dir,{recursive:true,force:true});}
});
