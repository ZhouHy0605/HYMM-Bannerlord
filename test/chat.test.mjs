import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {chatStore} from '../chat.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const first='76561198000000001',second='76561198000000002',admin='76561198000000003';
const profile={name:'玩家 <script>test</script>',avatar:'https://evil.example/avatar.png'};
const input=(text='你好',n=0)=>({text,nonce:String(n).padStart(20,'0')});

test('chat validates content, snapshots safe profiles, deduplicates retries and preserves throttles after reopening',()=>{
 const db=new DatabaseSync(':memory:'),chat=chatStore(db);
 try{
  for(const value of [null,{},input(''),input(' '.repeat(5)),input('x'.repeat(501)),input('a\n'.repeat(13)),input('\u0000'),{text:'hi',nonce:'bad'}])assert.throws(()=>chat.send(first,profile,value,100000),e=>e.status===400);
  assert.throws(()=>chat.send('fake',profile,input(),100000),e=>e.status===401);
  const empty=chat.view(),sent=chat.send(first,profile,input('Hello\r\n世界'),100000);
  assert.equal(sent.id,1);assert.deepEqual(chat.send(first,profile,input('Hello\r\n世界'),100001),sent);
  assert.throws(()=>chat.send(first,profile,input('different'),100002),e=>e.status===409);
  const view=chat.view();assert.notEqual(view.etag,empty.etag);assert.equal(chat.view(),view);
  assert.equal(view.data.messages[0].name,profile.name);assert.equal(view.data.messages[0].avatar,'');assert.equal(view.data.messages[0].text,'Hello\n世界');
  assert.throws(()=>chat.send(first,profile,input('too fast',1),101999),e=>e.status===429);
  for(let i=1;i<10;i++)chat.send(first,profile,input('message',i),100000+i*2000);
  assert.throws(()=>chatStore(db).send(first,profile,input('limit survives restart',11),120000),e=>e.status===429);
  chat.send(first,profile,input('allowed after window',12),161000);
 }finally{db.close();}
});
test('withdrawals and moderation erase public content, cannot be forged, and invalidate cached history',()=>{
 const db=new DatabaseSync(':memory:'),chat=chatStore(db);
 try{
  const {id}=chat.send(first,profile,input(),100000),before=chat.view();
  assert.throws(()=>chat.remove(second,id),e=>e.status===403);
  assert.throws(()=>chat.remove(first,'1'),e=>e.status===400);
  chat.remove(first,id);const after=chat.view();assert.notEqual(after.etag,before.etag);
  assert.deepEqual(after.data.messages,[{id,createdAt:100000,deleted:true}]);
  assert.equal(db.prepare('SELECT text FROM chat_messages WHERE id=?').get(id).text,'');
  chat.send(first,profile,input(),100001);assert.deepEqual(chat.view().data.messages,after.data.messages);
  assert.throws(()=>chat.send(first,profile,input('deleted messages still rate limited',2),100002),e=>e.status===429);
  const other=chat.send(second,profile,input(),100003);chat.remove(admin,other.id,true);
  assert(chat.view().data.messages.every(m=>m.deleted));
 }finally{db.close();}
});
test('chat keeps bounded storage and returns the latest 100 messages oldest first',()=>{
 const db=new DatabaseSync(':memory:'),chat=chatStore(db);
 try{
  for(let i=0;i<510;i++)chat.send(String(76561198000000000n+BigInt(i)),profile,input('message '+i),100000+i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n,500);
  const rows=chat.view().data.messages;assert.equal(rows.length,100);assert.equal(rows[0].id,411);assert.equal(rows.at(-1).id,510);
 }finally{db.close();}
});
test('chat HTTP enforces Steam authentication, CSRF, ownership, admin moderation, caching and persistence',async()=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const dir=await mkdtemp(path.join(os.tmpdir(),'hymm-chat-')),origin=`http://127.0.0.1:${port}`;let child;
 const launch=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:origin,PUBLIC_TEST_PORT:'',DATA_DIR:dir,ADMIN_STEAM_IDS:admin,ENABLE_DEMO:'1'},stdio:'ignore',windowsHide:true});for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('startup failed');};
 const stop=()=>new Promise(r=>{child.once('exit',r);child.kill();});
 const call=(route='/api/chat',data=null,token='',headers={})=>fetch(origin+route,{method:data?'POST':'GET',headers:{Cookie:'arena='+token,Origin:origin,'X-CSRF-Token':'test-csrf','Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined});
 try{
  await launch();const db=new DatabaseSync(path.join(dir,'arena.sqlite'));
  for(const [token,id,mode] of [['first',first,'ranked'],['second',second,'ranked'],['admin',admin,'ranked'],['demo','you','demo']])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),JSON.stringify({mode,userId:id,world:mode==='ranked'?'ranked':'demo:test',csrf:'test-csrf'}),Date.now()+60000);
  db.prepare('INSERT INTO worlds VALUES(?,?)').run('ranked',JSON.stringify({users:{[first]:{id:first,name:'First'},[second]:{id:second,name:'Second'},[admin]:{id:admin,name:'Admin'}},queue:[],matches:[],ledger:[],events:[]}));db.close();
  const initial=await call(),etag=initial.headers.get('ETag');assert.equal(initial.status,200);assert.deepEqual(await initial.json(),{messages:[]});
  assert.equal((await call('/api/chat',null,'',{'If-None-Match':etag})).status,304);
  for(const who of ['', 'demo'])assert.equal((await call('/api/chat',input(),who)).status,401);
  assert.equal((await call('/api/chat',input(),'first',{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await call('/api/chat',input(),'first',{Origin:'https://evil.example'})).status,403);
  const sent=await call('/api/chat',{...input('<img src=x onerror=alert(1)>'),authorId:second,name:'Forged'},'first');assert.equal(sent.status,200);const {id}=await sent.json();
  const updated=await call('/api/chat',null,'',{'If-None-Match':etag});assert.equal(updated.status,200);const row=(await updated.json()).messages[0];assert.equal(row.name,'First');assert.equal(row.authorId,first);
  assert.equal((await call('/api/chat/remove',{id,admin:true},'second')).status,403);
  assert.equal((await call('/api/chat',input('fast',1),'first')).status,429);
  await stop();await launch();assert.equal((await (await call()).json()).messages[0].id,id);
  assert.equal((await call('/api/chat/remove',{id},'admin')).status,200);
  const removed=(await (await call()).json()).messages[0];assert.equal(removed.deleted,true);assert.equal(removed.text,undefined);
 }finally{if(child&&!child.killed)await stop();await rm(dir,{recursive:true,force:true});}
});
