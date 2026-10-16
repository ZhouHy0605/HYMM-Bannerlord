import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {armoryCatalog as catalog,armoryStore,validateArmory} from '../armory.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

test('all six cultures and 42 classes have valid clothing choices and no slot conflicts',()=>{
 assert.equal(catalog.cultures.length,6);assert.equal(catalog.classes.length,42);
 const items=new Map(catalog.items.map(i=>[i.id,i]));
 for(const culture of catalog.cultures)assert.equal(catalog.classes.filter(c=>c.culture===culture.id).length,7);
 for(const c of catalog.classes){
  assert.ok(c.items.length>0);
  for(const id of c.items){assert.ok(items.has(id));assert.deepEqual(validateArmory({classId:c.id,items:[id]}).items,[id]);}
  const onePerSlot=catalog.slots.map(s=>c.items.find(id=>items.get(id).slot===s.id)).filter(Boolean);
  assert.doesNotThrow(()=>validateArmory({classId:c.id,items:onePerSlot}));
  assert.throws(()=>validateArmory({classId:c.id,items:[c.items[0],c.items[0]]}));
  const foreign=catalog.items.find(i=>!c.items.includes(i.id));assert.throws(()=>validateArmory({classId:c.id,items:[foreign.id]}));
 }
 assert.throws(()=>validateArmory({classId:'__proto__',items:[]}));
 assert.throws(()=>validateArmory({classId:catalog.classes[0].id,items:['taunt_1']}));
});
test('presets are independent by player/class, reset does not erase other classes',()=>{
 const db=new DatabaseSync(':memory:'),store=armoryStore(db),[a,b]=catalog.classes;
 store.save('a',{classId:a.id,items:[a.items[0]]});store.save('a',{classId:b.id,items:[]});
 assert.deepEqual(store.get('b'),{});
 assert.deepEqual(store.save('a',{classId:a.id,items:null}),{[b.id]:[]});
 assert.throws(()=>store.batch(['not-steam']));db.close();
});

test('armory delta sends only changed players and explicit resets; versions survive store recreation',()=>{
 const db=new DatabaseSync(':memory:'),store=armoryStore(db),[c]=catalog.classes;
 const a='76561198000000001',b='76561198000000002';
 store.save(a,{classId:c.id,items:[c.items[0]]});
 const first=store.delta([a,b],{});assert.deepEqual(first.profiles[b],{});
 assert.deepEqual(store.delta([a,b],first.versions).profiles,{});
 assert.deepEqual(armoryStore(db).delta([a,b],first.versions).profiles,{});
 store.save(a,{classId:c.id,items:[]});const changed=store.delta([a,b],first.versions);
 assert.deepEqual(changed.profiles,{[a]:{[c.id]:[]}});
 store.save(a,{classId:c.id,items:null});assert.deepEqual(store.delta([a,b],changed.versions).profiles,{[a]:{}});
 assert.throws(()=>store.delta([a],null));assert.throws(()=>store.delta([a],{[a]:123}));
 assert.deepEqual(Object.keys(store.batch([a,b])),[a,b]);db.close();
});
test('Skirmish in a multi-mode perk grants heavy infantry shoulder choices and states their skill requirements',()=>{
 const legion=catalog.classes.find(c=>c.id==='mp_heavy_infantry_empire');
 const varangian=catalog.classes.find(c=>c.id==='mp_heavy_infantry_sturgia');
 const capes=c=>c.items.filter(id=>catalog.items.find(i=>i.id===id).slot==='Cape');
 assert.equal(capes(legion).length,6);assert.equal(capes(varangian).length,2);
 for(const id of capes(legion)){assert.deepEqual(legion.requirements[id],['覆板护甲']);assert.doesNotThrow(()=>validateArmory({classId:legion.id,items:[id]}));}
 for(const id of capes(varangian)){assert.deepEqual(varangian.requirements[id],['填充护甲']);assert.doesNotThrow(()=>validateArmory({classId:varangian.id,items:[id]}));}
 assert.equal(legion.requirements.mp_empire_battle_crown_north,undefined);
 assert.equal(legion.requirements.mp_empire_legion_b,undefined);
});
test('HYMM legionary exceptions grant both cavalry cosmetics only to the requested infantry class',()=>{
 const crown='mp_empire_battle_crown_north',armor='mp_empire_legion_b',legion='mp_heavy_infantry_empire';
 assert.deepEqual(validateArmory({classId:legion,items:[crown,armor]}).items,[crown,armor].sort());
 for(const id of ['mp_skirmisher_empire','mp_shock_infantry_empire','mp_light_ranged_empire','mp_heavy_ranged_empire']){
  assert.throws(()=>validateArmory({classId:id,items:[crown]}));
  assert.throws(()=>validateArmory({classId:id,items:[armor]}));
 }
 assert.doesNotThrow(()=>validateArmory({classId:'mp_heavy_cavalry_empire',items:[crown]}));
 assert.doesNotThrow(()=>validateArmory({classId:'mp_light_cavalry_empire',items:[armor]}));
 assert.ok(catalog.items.find(x=>x.id===crown).replaces.includes('mp_ironlame_nasalhelm_over_imperial_mail'));
 assert.ok(catalog.items.find(x=>x.id===armor).replaces.includes('mp_legionary_mail'));
});
test('Oathsworn includes both native headArmor cosmetics and Sergeant alone gains the crossbow armor exception',()=>{
 const oath='mp_heavy_infantry_battania',sergeant='mp_heavy_infantry_vlandia',armor='mp_sturgian_fortified_armor';
 const helmets=['mp_battanian_noble_helmet_with_feather','mp_battanian_plated_noble_helmet'];
 const c=catalog.classes.find(c=>c.id===oath);
 assert.deepEqual(c.items.filter(id=>catalog.items.find(i=>i.id===id).slot==='Head').sort(),helmets.sort());
 for(const id of helmets)assert.doesNotThrow(()=>validateArmory({classId:oath,items:[id]}));
 for(const classId of [sergeant,'mp_heavy_ranged_vlandia'])assert.doesNotThrow(()=>validateArmory({classId,items:[armor]}));
 for(const classId of ['mp_light_infantry_vlandia','mp_shock_infantry_vlandia','mp_light_ranged_vlandia','mp_light_cavalry_vlandia','mp_heavy_cavalry_vlandia'])assert.throws(()=>validateArmory({classId,items:[armor]}));
 assert.ok(catalog.items.find(i=>i.id===armor).replaces.includes('mp_vlandia_chainmail'));
});

test('armory HTTP enforces Steam session, CSRF, bridge token and persists per-account presets',async()=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const dir=await mkdtemp(path.join(os.tmpdir(),'hymm-armory-')),origin=`http://127.0.0.1:${port}`,token='armory-integration-test-bridge-token-12345';
 let child;const launch=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,PUBLIC_TEST_PORT:'',DATA_DIR:dir,BRIDGE_TOKEN:token,ENABLE_DEMO:'1'},stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('startup failed');};
 const stop=()=>new Promise(r=>{child.once('exit',r);child.kill();});
 const call=(p,body,cookie='first',headers={})=>fetch(origin+p,{method:body?'POST':'GET',headers:{Cookie:'arena='+cookie,Origin:origin,'X-CSRF-Token':'csrf-test','Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 try{
  await launch();const db=new DatabaseSync(path.join(dir,'arena.sqlite'));
  for(const [name,id,mode] of [['first','76561198000000001','ranked'],['second','76561198000000002','ranked'],['demo','you','demo']])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(name).digest('hex'),JSON.stringify({mode,userId:id,world:mode==='ranked'?'ranked':'demo:test',csrf:'csrf-test'}),Date.now()+60000);db.close();
  const c=catalog.classes[0],data={classId:c.id,items:[c.items[0]]};
  assert.equal((await call('/api/armory',null,'guest')).status,401);
  assert.equal((await call('/api/armory',data,'demo')).status,401);
  assert.equal((await call('/api/armory',data,'first',{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await call('/api/armory',data,'first',{Origin:'https://wrong.test'})).status,403);
  assert.equal((await call('/api/armory',{...data,items:['mp_fake']})).status,400);
  assert.equal((await call('/api/armory',{...data,userId:'76561198000000002'})).status,200);
  assert.deepEqual((await (await call('/api/armory',null,'second')).json()).classes,{});
  assert.equal((await call('/api/bridge/armory',{ids:['76561198000000001']})).status,401);
  const b=await call('/api/bridge/armory',{ids:['76561198000000001']},'',{Authorization:'Bearer '+token});assert.deepEqual((await b.json()).profiles['76561198000000001'],{[c.id]:data.items});
  const delta=await (await call('/api/bridge/armory',{ids:['76561198000000001'],versions:{}},'',{Authorization:'Bearer '+token})).json();
  const unchanged=await (await call('/api/bridge/armory',{ids:['76561198000000001'],versions:delta.versions},'',{Authorization:'Bearer '+token})).json();
  assert.deepEqual(unchanged.profiles,{});assert.deepEqual(unchanged.versions,delta.versions);
  await stop();await launch();assert.deepEqual((await (await call('/api/armory')).json()).classes,{[c.id]:data.items});
  await call('/api/armory',{classId:c.id,items:[]});assert.deepEqual((await (await call('/api/armory')).json()).classes,{[c.id]:[]});
  await call('/api/armory',{classId:c.id,items:null});assert.deepEqual((await (await call('/api/armory')).json()).classes,{});
 }finally{if(child&&!child.killed)await stop();await rm(dir,{recursive:true,force:true});}
});
