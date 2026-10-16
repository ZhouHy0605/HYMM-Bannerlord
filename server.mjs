import {PERFORMANCE_RULE} from './rating.mjs';
import {ratingVisibility} from './rating-visibility.mjs';
import {assetDelivery,sendJSON as json} from './http-delivery.mjs';
import {armoryStore} from './armory.mjs';
import {clientIP} from './client-ip.mjs';
import {adminAction,adminView,heartbeat,monitor} from './operations.mjs';
import {combatStats} from './combat.mjs';
import {steamProfile} from './steam-profile.mjs';
import {createSteamRequest} from './steam-network.mjs';
import {originConfig} from './origin-config.mjs';
import {imageAssets} from './public/image-assets.js';
import {existsSync} from 'node:fs';
import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import * as game from './engine.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
if(existsSync(path.join(ROOT,'.env')))process.loadEnvFile(path.join(ROOT,'.env'));
const steamRequest=createSteamRequest(process.env.STEAM_HTTP_PROXY||'');
const HOST=process.env.HOST||'127.0.0.1',PORT=Number(process.env.PORT||3210);
const {origin:ORIGIN,secure:SECURE,publicTestPort}=originConfig(process.env);
const ADMIN_IDS=new Set((process.env.ADMIN_STEAM_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
if([...ADMIN_IDS].some(id=>!/^\d{17}$/.test(id)))throw new Error('ADMIN_STEAM_IDS must contain SteamID64 values');
const MATCH_FORMAT=process.env.MATCH_FORMAT||'two-leg-v1';
if(!['single-v1','two-leg-v1'].includes(MATCH_FORMAT))throw new Error('Invalid MATCH_FORMAT');
const isAdmin=ses=>ses?.mode==='ranked'&&ADMIN_IDS.has(ses.userId);
const DEMO=process.env.ENABLE_DEMO!=='0',RANKED=process.env.ENABLE_RANKED==='1';
const dataDir=process.env.DATA_DIR||path.join(ROOT,'data');await mkdir(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'arena.sqlite'));db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_states(id TEXT PRIMARY KEY, return_to TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);`);
const armory=armoryStore(db);
const hash=x=>createHash('sha256').update(x).digest('hex'),random=()=>randomBytes(32).toString('hex');
function world(id){const row=db.prepare('SELECT body FROM worlds WHERE id=?').get(id);const s=row?JSON.parse(row.body):game.empty();s.matchFormat=MATCH_FORMAT;s.ratingRule=id==='ranked'?PERFORMANCE_RULE:'elo-team-v1';return s;}
function save(id,s){db.prepare('INSERT INTO worlds VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(s));}
function mutate(id,fn){db.exec('BEGIN IMMEDIATE');try{const s=world(id);const result=fn(s);save(id,s);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function session(req){const value=cookies(req).arena;if(!value)return null;const row=db.prepare('SELECT body FROM sessions WHERE id=? AND expires>?').get(hash(value),Date.now());return row?JSON.parse(row.body):null;}
function cookie(name,value,maxAge){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE?'; Secure':''}`;}
function newSession(res,mode,userId){const token=random();const s={mode,userId,csrf:random(),world:mode==='demo'?`demo:${random()}`:'ranked'};db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),JSON.stringify(s),Date.now()+86400000);res.setHeader('Set-Cookie',cookie('arena',token,86400));return s;}
function redirect(res,url){res.writeHead(302,{Location:url,'Cache-Control':'no-store'});res.end();}
async function body(req){let buffer='';for await(const chunk of req){buffer+=chunk;if(Buffer.byteLength(buffer)>16384)game.fail('请求过大',413);}try{return JSON.parse(buffer||'{}');}catch{game.fail('无效 JSON',400);}}
function protectedPost(req,s){if(req.headers.origin!==ORIGIN)game.fail('来源校验失败',403);if(!s||req.headers['x-csrf-token']!==s.csrf)game.fail('请刷新页面后重试',403);}
const limits=new Map();function rate(req){const key=clientIP(req,process.env.TRUST_LOCAL_PROXY==='1');const now=Date.now();let x=limits.get(key);if(!x||x.until<now){x={count:0,until:now+60000};limits.set(key,x);}if(++x.count>500)game.fail('操作过于频繁，请稍后再试',429);}
function view(ses,partial=false){
 const s=world(ses?.world||'ranked');const me=ses?s.users[ses.userId]:null;
 const own=ses?s.matches.filter(m=>m.phase!=='cancelled'&&m.players.includes(ses.userId)):[];
 const current=own.find(m=>game.ACTIVE.includes(m.phase))||null;
 const selected=new Set([ses?.userId,...s.queue.map(q=>q.id),...(current?.players||[]),...(own[0]?.players||[])]);
 const users=partial?Object.fromEntries(Object.entries(s.users).filter(([id])=>selected.has(id))):s.users;
 for(const u of Object.values(users))u.combat=combatStats(s,u.id);
 return ratingVisibility({isAdmin:isAdmin(ses),matchFormat:MATCH_FORMAT,mode:ses?.mode||'guest',csrf:ses?.csrf,me:me?{...me,rank:game.rank(me.rating)}:null,config:{demo:DEMO,ranked:RANKED,steam:true},
  queue:s.queue.map(q=>({at:q.at,user:users[q.id]})),current,
  matches:own.slice(0,partial?1:30),users,
  ...(partial?{partial:true}:{leaderboard:Object.values(s.users).sort((a,b)=>b.rating-a.rating).slice(0,100).map(u=>({...u,rank:game.rank(u.rating)})),ledger:ses?s.ledger.filter(l=>l.userId===ses.userId).slice(-30).reverse():[],maps:game.MAPS,cultures:game.CULTURES}),
  rooms:s.matches.filter(m=>game.ACTIVE.includes(m.phase)).map(m=>({id:m.id,number:m.number,phase:m.phase,players:m.players.length,map:m.map,cultures:m.cultures,server:m.server?.name||null,mine:m.players.includes(ses?.userId)})),now:Date.now()});
}
const steamEndpoint='https://steamcommunity.com/openid/login';
async function authCallback(req,res,url){
 const state=cookies(req).steam_state;const row=state?db.prepare('SELECT * FROM login_states WHERE id=? AND expires>?').get(hash(state),Date.now()):null;
 if(!row||url.searchParams.get('state')!==state)game.fail('Steam 登录已过期，请重试',400);
 db.prepare('DELETE FROM login_states WHERE id=?').run(hash(state));res.setHeader('Set-Cookie',cookie('steam_state','',0));
 const q=url.searchParams,claim=q.get('openid.claimed_id')||'',nonce=q.get('openid.response_nonce')||'';
 const signed=new Set((q.get('openid.signed')||'').split(','));
 if(q.get('openid.ns')!=='http://specs.openid.net/auth/2.0'||q.get('openid.mode')!=='id_res'||q.get('openid.op_endpoint')!==steamEndpoint||q.get('openid.return_to')!==row.return_to||q.get('openid.identity')!==claim||!/^https:\/\/steamcommunity\.com\/openid\/id\/\d{17}$/.test(claim)||!['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle'].every(x=>signed.has(x)))game.fail('Steam 身份验证响应无效',400);
 const timestamp=Date.parse(nonce.slice(0,20));if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>300000||db.prepare('SELECT id FROM nonces WHERE id=?').get(hash(nonce)))game.fail('Steam 响应已过期或被重复使用',400);
 const verify=new URLSearchParams([...q].filter(([k])=>k.startsWith('openid.')));verify.set('openid.mode','check_authentication');
 let response;
 try{response=await steamRequest(steamEndpoint,{method:'POST',body:verify,signal:AbortSignal.timeout(15000)});}
 catch(e){console.error('Steam OpenID verification connection failed:',e.cause?.code||e.name);game.fail('服务器暂时无法连接 Steam 完成身份确认，请稍后重试或联系管理员检查 Steam 连接。',503);}
 const answer=await response.text();if(!response.ok||!/^is_valid:true\r?$/m.test(answer))game.fail('Steam 未确认此次登录',401);
 db.prepare('INSERT INTO nonces VALUES(?,?)').run(hash(nonce),Date.now()+600000);
 const id=claim.split('/').at(-1),profile=await steamProfile(id,process.env.STEAM_WEB_API_KEY,steamRequest);
 const old=session(req);if(old){const value=cookies(req).arena;db.prepare('DELETE FROM sessions WHERE id=?').run(hash(value));}
 newSession(res,'ranked',id);mutate('ranked',s=>{const u=game.user(s,id,`骑士 ${id.slice(-6)}`);if(profile)Object.assign(u,profile);});redirect(res,'/');
}
const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/lobby.css':'lobby.css','/layout.css':'layout.css','/favicon.svg':'favicon.svg'};
for(const name of ['Joker','Peasant','Guard','Knight','MasterKnight','Lord','Duke','Prince','King','Emperor'])assets['/ranks/'+name+'.png']='ranks/'+name+'.png';
assets['/medieval.css']='medieval.css';
assets['/camp.css']='camp.css';
assets['/campaign.css']='campaign.css';
assets['/castle.css']='castle.css';
assets['/menu.css']='menu.css';
assets['/match-audio.js']='match-audio.js';
assets['/castle-dawn.png']='castle-dawn.png';
assets['/castle-stone.png']='castle-stone.png';
assets['/campaign-map.png']='campaign-map.png';
assets['/calradia-banner.png']='calradia-banner.png';
for(const map of game.IDLE_MAPS)assets[map.image]=map.image.slice(1);
for(const name of ['Joker','Peasant','Guard','Knight','MasterKnight','Lord','Duke','Prince','King','Emperor'])assets['/ranks/tarot/'+name+'.png']='ranks/tarot/'+name+'.png';
assets['/image-assets.js']='image-assets.js';
assets['/state-sync.js']='state-sync.js';
for(const file of ['armory.js','armory.css','armory-catalog.json'])assets['/'+file]=file;
const immutableImages=new Set([...Object.values(imageAssets.backgrounds),...Object.values(imageAssets.ranks).flatMap(Object.values),...Object.values(imageAssets.maps)]);
for(const url of immutableImages)assets[url]=url.slice(1);
assets['/fonts/unifrakturcook-latin.woff2']='fonts/unifrakturcook-latin.woff2';
assets['/fonts/OFL.txt']='fonts/OFL.txt';
const types={json:'application/json; charset=utf-8',woff2:'font/woff2',txt:'text/plain; charset=utf-8',webp:'image/webp',jpg:'image/jpeg',png:'image/png',html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
const serveAsset=assetDelivery(path.join(ROOT,'public'),assets,immutableImages,types);
export const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://avatars.cloudflare.steamstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://steamcommunity.com");
 try{
  rate(req);const url=new URL(req.url,ORIGIN),ses=session(req),p=url.pathname;
  if(req.method==='GET'&&p==='/api/state')return json(res,200,view(ses,url.searchParams.get('view')==='live'));
  if(p==='/api/armory'){
   if(ses?.mode!=='ranked')game.fail('请先使用 Steam 登录',401);
   if(req.method==='GET')return json(res,200,{classes:armory.get(ses.userId)});
   if(req.method==='POST'){protectedPost(req,ses);return json(res,200,{classes:armory.save(ses.userId,await body(req))});}
  }
  if(p.startsWith('/api/admin/')){
   if(!isAdmin(ses))game.fail('仅站点管理员可以操作',403);
   if(req.method==='GET'&&p==='/api/admin/state')return json(res,200,adminView(world('ranked')));
   if(req.method==='POST'&&p==='/api/admin/action'){protectedPost(req,ses);const b=await body(req);mutate('ranked',s=>adminAction(s,ses.userId,b));return json(res,200,adminView(world('ranked')));}
  }
  if(req.method==='GET'&&p==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&p==='/auth/steam'){
   const state=random(),returnTo=`${ORIGIN}/auth/steam/callback?state=${state}`;
   db.prepare('INSERT INTO login_states VALUES(?,?,?)').run(hash(state),returnTo,Date.now()+300000);res.setHeader('Set-Cookie',cookie('steam_state',state,300));
   const u=new URL(steamEndpoint);for(const [k,v]of Object.entries({ns:'http://specs.openid.net/auth/2.0',mode:'checkid_setup',return_to:returnTo,realm:ORIGIN+'/',identity:'http://specs.openid.net/auth/2.0/identifier_select',claimed_id:'http://specs.openid.net/auth/2.0/identifier_select'}))u.searchParams.set('openid.'+k,v);return redirect(res,u.href);
  }
  if(req.method==='GET'&&p==='/auth/steam/callback')return await authCallback(req,res,url);
  if(req.method==='POST'&&p==='/api/demo'){
   if(!DEMO)game.fail('演示模式已关闭',404);if(req.headers.origin!==ORIGIN)game.fail('来源校验失败',403);
   if(ses?.mode==='ranked')game.fail('请先退出 Steam 账号再进入演示',409);
   if(ses?.mode==='demo'){return json(res,200,view(ses));}
   const created=newSession(res,'demo','you');mutate(created.world,s=>game.user(s,'you','我的骑士'));return json(res,200,view(created));
  }
  if(req.method==='POST'&&p==='/api/logout'){
   protectedPost(req,ses);mutate(ses.world,s=>{s.queue=s.queue.filter(q=>q.id!==ses.userId);});db.prepare('DELETE FROM sessions WHERE id=?').run(hash(cookies(req).arena));res.setHeader('Set-Cookie',cookie('arena','',0));return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&p==='/api/action'){
   protectedPost(req,ses);const b=await body(req);
   if(b.type==='join'&&ses.mode==='ranked'&&!RANKED)game.fail('正式排位将在云端联调通过后开放');
   mutate(ses.world,s=>{game.tick(s);if(b.type==='demo-fill-24'&&ses.mode==='demo')game.fillDemo24(s,ses.userId);else if(b.type==='demo-fill'&&ses.mode==='demo')game.fillDemo(s,ses.userId);else game.action(s,ses.userId,b,Date.now(),ses.mode==='demo');});return json(res,200,view(ses));
  }
  if(p.startsWith('/api/bridge/')){
   const token=process.env.BRIDGE_TOKEN||'',supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
   if(token.length<32||!timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(token))))game.fail('Unauthorized bridge',401);
   if(req.method==='POST'&&p==='/api/bridge/armory'){const b=await body(req);return json(res,200,b.versions===undefined?{profiles:armory.batch(b.ids)}:armory.delta(b.ids,b.versions));}
   if(req.method==='POST'&&p==='/api/bridge/heartbeat'){const b=await body(req);return json(res,200,mutate('ranked',s=>heartbeat(s,b)));}
   if(req.method==='GET'&&p==='/api/bridge/jobs')return json(res,200,world('ranked').matches.filter(m=>m.phase==='awaiting_server').sort((a,b)=>a.createdAt-b.createdAt||(a.number||0)-(b.number||0)).map(game.job));
   if(req.method==='POST'&&p==='/api/bridge/claim'){const b=await body(req);return json(res,200,mutate('ranked',s=>game.claim(s,b)));}
   if(req.method==='POST'&&p==='/api/bridge/events'){const b=await body(req);mutate('ranked',s=>game.bridge(s,b));return json(res,200,{ok:true});}
  }
  if(req.method==='GET'&&assets[p])return await serveAsset(req,res,url);
  game.fail('页面不存在',404);
 }catch(e){const status=e.status||502;if(!e.status)console.error('Request failure:',e.name);if(req.url.startsWith('/auth/'))return redirect(res,'/?authError='+encodeURIComponent(e.status?e.message:'Steam 暂时无法连接，请稍后重试'));json(res,status,{error:e.status?e.message:'服务暂时不可用，请稍后重试'});}
});
const timer=setInterval(()=>{
 try{for(const row of db.prepare('SELECT id FROM worlds').all())mutate(row.id,s=>{game.tick(s);monitor(s);});
  const now=Date.now();db.prepare('DELETE FROM login_states WHERE expires<?').run(now);db.prepare('DELETE FROM nonces WHERE expires<?').run(now);db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
  for(const [key,v]of limits)if(v.until<now)limits.delete(key);
 }catch(e){console.error('Tick failure',e.message);}
},1000);timer.unref();
server.listen(PORT,HOST,()=>console.log(`Arena ready: ${ORIGIN} | demo=${DEMO} ranked=${RANKED}`));
// Preserve the loopback bridge endpoint while exposing the same application directly for an opted-in HTTP test.
const listeners=[server];
if(publicTestPort){
 const direct=http.createServer(server.listeners('request')[0]);listeners.push(direct);
 direct.listen(publicTestPort,'0.0.0.0',()=>console.log(`Direct HTTP testing enabled on port ${publicTestPort}; sessions are not encrypted`));
}
let closing=false;
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{if(closing)return;closing=true;clearInterval(timer);let remaining=listeners.length;for(const listener of listeners)listener.close(()=>{if(--remaining===0){db.close();process.exit(0);}});});
