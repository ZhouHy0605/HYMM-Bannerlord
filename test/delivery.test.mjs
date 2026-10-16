import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {assetDelivery,sendJSON,acceptsGzip} from '../http-delivery.mjs';
import {pollDelay,statePath,mergeState} from '../public/state-sync.js';

test('adaptive polling keeps participants fast, including hidden tabs; partial state preserves history and rejects session changes',()=>{
 const old={mode:'ranked',me:{id:'a'},isAdmin:false,queue:[],current:null,maps:['map'],users:{a:{name:'old'},b:{name:'history'}},matches:[{id:'old',phase:'settled'}]};
 assert.equal(pollDelay(old),10000);assert.equal(pollDelay(old,true),30000);
 assert.equal(pollDelay({...old,queue:[{user:{id:'a'}}]},true),2500);
 assert.equal(pollDelay({...old,current:{phase:'ready'}},true),2500);
 assert.equal(statePath(null,'home'),'/api/state');assert.equal(statePath(old,'home'),'/api/state?view=live');
 for(const tab of ['profile','history','rank','ranks'])assert.equal(statePath(old,tab),'/api/state');
 const next={...old,partial:true,current:{id:'new',phase:'ready'},users:{a:{name:'new'}},matches:[{id:'new',phase:'ready'}]};delete next.maps;
 const merged=mergeState(old,next);assert.equal(merged.current.phase,'ready');assert.equal(merged.users.b.name,'history');assert.equal(merged.users.a.name,'new');assert.equal(merged.matches.length,2);assert.deepEqual(merged.maps,['map']);assert.equal(merged.partial,undefined);
 assert.throws(()=>mergeState(old,{...next,mode:'guest',me:null}));
 assert.throws(()=>mergeState(old,{...next,isAdmin:true}));
 assert.deepEqual(mergeState(old,{mode:'guest',me:null}),{mode:'guest',me:null});
});

test('versioned dependency chain, compression negotiation, conditional GET and private JSON isolation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hymm-delivery-'));
 let server;
 const raw=(origin,p,headers={})=>new Promise((resolve,reject)=>{http.get(origin+p,{headers},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}));}).on('error',reject);});
 const assets={'/':'index.html','/app.js':'app.js','/dep.js':'dep.js','/style.css':'style.css','/font.woff2':'font.woff2'};
 const types={html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'};
 try{
  await Promise.all([writeFile(path.join(dir,'index.html'),'<link href="/style.css"><script src="/app.js"></script>'),writeFile(path.join(dir,'app.js'),"import {x} from './dep.js';\n"+'// padding\n'.repeat(300)),writeFile(path.join(dir,'dep.js'),'export const x=1;'),writeFile(path.join(dir,'style.css'),'body{font:url("/font.woff2")}'),writeFile(path.join(dir,'font.woff2'),'font')]);
  let serve=assetDelivery(dir,assets,new Set(),types);
  server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname==='/api')return sendJSON(res,200,{owner:req.headers.cookie||'guest',data:'hello'.repeat(500)});serve(req,res,url).catch(()=>{res.writeHead(500);res.end();});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const home=await raw(origin,'/');assert.equal(home.headers['cache-control'],'no-cache');
  const appURL=home.body.toString().match(/src="([^"]+)/)[1];assert.match(appURL,/\/app.js\?v=/);
  const plain=await raw(origin,appURL),gzip=await raw(origin,appURL,{'Accept-Encoding':'gzip'});
  assert.match(gzip.headers['cache-control'],/immutable/);assert.equal(gzip.headers['content-encoding'],'gzip');assert.ok(gzip.body.length<plain.body.length/4);assert.deepEqual(gunzipSync(gzip.body),plain.body);assert.notEqual(gzip.headers.etag,plain.headers.etag);assert.match(plain.body.toString(),/from '\/dep.js\?v=/);
  assert.equal((await raw(origin,appURL,{'Accept-Encoding':'gzip','If-None-Match':'W/'+gzip.headers.etag})).status,304);
  assert.equal((await raw(origin,appURL,{'Accept-Encoding':'identity','If-None-Match':gzip.headers.etag})).status,200);
  assert.equal((await raw(origin,appURL,{'Accept-Encoding':'gzip;q=0, *;q=1'})).headers['content-encoding'],undefined);
  assert.equal(acceptsGzip({headers:{'accept-encoding':'br, gzip;q=0.5'}}),true);
  const a=await raw(origin,'/api',{'Accept-Encoding':'gzip',Cookie:'a'}),b=await raw(origin,'/api',{Cookie:'b'});
  assert.equal(a.headers['cache-control'],'no-store');assert.equal(a.headers.vary,'Accept-Encoding');assert.equal(JSON.parse(gunzipSync(a.body)).owner,'a');assert.equal(JSON.parse(b.body).owner,'b');
  await writeFile(path.join(dir,'dep.js'),'export const x=2;');
  serve=assetDelivery(dir,assets,new Set(),types);const newer=await raw(origin,'/');assert.notEqual(newer.body.toString(),home.body.toString());
  assert.equal((await raw(origin,appURL)).headers['cache-control'],'no-cache');
 }finally{if(server)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
