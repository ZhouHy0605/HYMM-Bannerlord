import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {imageAssets} from '../public/image-assets.js';
const root=new URL('../',import.meta.url);
test('HTTP: demo lifecycle, CSRF, persistence, isolation and Steam redirect',async()=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://127.0.0.1:${port}`,dir=await mkdtemp(path.join(os.tmpdir(),'arena-test-'));
 let child,cookie='',csrf='';
 const launch=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,DATA_DIR:dir,ENABLE_DEMO:'1',ENABLE_RANKED:'0',MATCH_FORMAT:'single-v1',BRIDGE_TOKEN:''},stdio:'ignore'});for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server did not start');};
 const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();});
 const req=async(p,b,extra={})=>{const r=await fetch(origin+p,{method:b?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json',...extra},body:b?JSON.stringify(b):undefined,redirect:'manual'});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return r;};
 try{
  await launch();assert.equal((await req('/')).status,200);assert.equal((await req('/api/bridge/jobs')).status,401);
  const font=await req('/fonts/unifrakturcook-latin.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');assert.equal(Buffer.from(await font.arrayBuffer()).toString('ascii',0,4),'wOF2');assert.match(await (await req('/fonts/OFL.txt')).text(),/SIL OPEN FONT LICENSE/);
  const art=await req(imageAssets.backgrounds['castle-dawn']);
  assert.equal(art.status,200);assert.equal(art.headers.get('content-type'),'image/webp');
  assert.match(art.headers.get('cache-control'),/max-age=31536000, immutable/);
  const bytes=Buffer.from(await art.arrayBuffer());assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<200000);
  const cached=await req(imageAssets.backgrounds['castle-dawn'],null,{'If-None-Match':art.headers.get('etag')});
  assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  const script=await req('/image-assets.js');assert.equal(script.headers.get('cache-control'),'no-cache');
  assert.equal((await req('/image-assets.js',null,{'If-None-Match':'W/'+script.headers.get('etag')})).status,304);
  assert.equal((await req('/api/state')).headers.get('cache-control'),'no-store');
  assert.equal((await req('/media/unlisted.0123456789abcdef.webp')).status,404);
  assert.equal((await req('/api/demo',{}, {Origin:'https://evil.example'})).status,403);
  let s=await (await req('/api/demo',{})).json();csrf=s.csrf;
  assert.equal((await req('/api/action',{type:'demo-fill'},{'X-CSRF-Token':'bad'})).status,403);
  s=await (await req('/api/action',{type:'demo-fill'})).json();let m=s.current;assert.equal(m.players.length,12);
  const live=await (await req('/api/state?view=live')).json();
  assert.equal(live.partial,true);assert.deepEqual(live.current,s.current);assert.equal(live.me.id,s.me.id);
  for(const key of ['maps','cultures','leaderboard','ledger'])assert.equal(live[key],undefined);
  for(const id of m.players)assert.ok(live.users[id]);
  assert.equal(live.me.rating,undefined);assert.ok(JSON.stringify(live).length<JSON.stringify(s).length);
  const fullAgain=await (await req('/api/state')).json();assert.equal(fullAgain.partial,undefined);assert.equal(fullAgain.maps.length,s.maps.length);
  const act=async(type,data={})=>{const r=await req('/api/action',{type,matchId:m.id,revision:m.revision,...data});assert.equal(r.status,200,await r.clone().text());s=await r.json();m=s.current||s.matches[0];};
  await act('demo-ready');await act('demo-election');for(let i=0;i<10;i++)await act('pick',{playerId:m.players.find(id=>!m.teams.flat().includes(id))});await act('demo-start');await act('demo-result',{score:[3,1]});assert.equal(s.ledger.length,0);assert.equal(s.me.rating,undefined);assert.equal(s.matches[0].changes,undefined);
  const persisted=new DatabaseSync(path.join(dir,'arena.sqlite'),{readOnly:true});const demoWorld=JSON.parse(persisted.prepare("SELECT body FROM worlds WHERE id LIKE 'demo:%'").get().body);persisted.close();assert.equal(demoWorld.ledger.filter(l=>l.userId==='you').length,1);assert.equal(typeof demoWorld.users.you.rating,'number');
  const savedCookie=cookie;cookie='';const guest=await (await req('/api/state')).json();assert.equal(guest.leaderboard.length,0);cookie=savedCookie;
  await stop();await launch();s=await (await req('/api/state')).json();assert.equal(s.matches[0].phase,'settled');assert.equal(s.ledger.length,0);assert.equal(s.me.rating,undefined);assert.equal(s.matches[0].changes,undefined);
  s=await (await req('/api/action',{type:'demo-fill-24'})).json();assert.equal(s.rooms.length,2);assert.equal(s.rooms.filter(r=>r.mine).length,1);assert.equal(s.cultures.length,6);assert.equal(s.queue.length,0);assert.equal((await req('/calradia-banner.png')).status,200);
  // Seed cancellations ahead of a completed match: filtering must precede the history limit.
  await stop();
  const seed=new DatabaseSync(path.join(dir,'arena.sqlite'));
  const row=seed.prepare("SELECT id,body FROM worlds WHERE id LIKE 'demo:%'").get(),saved=JSON.parse(row.body);
  saved.matches.unshift(...Array.from({length:35},(_,i)=>({...saved.matches[0],id:'cancelled-'+i,phase:'cancelled',deadline:null})));
  seed.prepare('UPDATE worlds SET body=? WHERE id=?').run(JSON.stringify(saved),row.id);seed.close();
  await launch();
  for(const route of ['/api/state','/api/state?view=live']){
   const visible=await (await req(route)).json();assert.ok(visible.matches.length);assert.ok(visible.matches.every(m=>m.phase!=='cancelled'));
   if(route==='/api/state')assert.ok(visible.matches.some(m=>m.phase==='settled'));
  }
  const stored=new DatabaseSync(path.join(dir,'arena.sqlite'),{readOnly:true});
  assert.equal(JSON.parse(stored.prepare('SELECT body FROM worlds WHERE id=?').get(row.id).body).matches.filter(m=>m.phase==='cancelled').length,35);stored.close();
  const auth=await req('/auth/steam');assert.equal(auth.status,302);assert.equal(new URL(auth.headers.get('location')).hostname,'steamcommunity.com');
  const forged=await req('/auth/steam/callback?openid.mode=id_res');assert.equal(forged.status,302);assert.match(forged.headers.get('location'),/authError=/);
 }finally{if(child&&!child.killed)await stop();await rm(dir,{recursive:true,force:true});}
});
