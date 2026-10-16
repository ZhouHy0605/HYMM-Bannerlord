import {combatStats} from '../../combat.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';
import * as g from '../../engine.mjs';
const root=new URL('../../',import.meta.url),dir=await mkdtemp(path.join(os.tmpdir(),'arena-bridge-'));
const s=g.empty();s.matchFormat='two-leg-v1';s.ratingRule='blmm-class-v1';for(let i=0;i<12;i++){const id=String(76561198000000000n+BigInt(i));g.user(s,id,'P'+i);g.action(s,id,{type:'join'},1000);}
const m=s.matches[0];g.action(s,m.players[0],{type:'demo-ready',matchId:m.id,revision:m.revision},2000,true);for(let i=0;i<11;i++)g.tick(s,m.deadline+1);
const db=new DatabaseSync(path.join(dir,'arena.sqlite'));db.exec('CREATE TABLE worlds(id TEXT PRIMARY KEY,body TEXT NOT NULL)');db.prepare('INSERT INTO worlds VALUES(?,?)').run('ranked',JSON.stringify(s));db.close();
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const origin=`http://127.0.0.1:${port}`,token='test-token-only-not-for-production-123456';
const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PUBLIC_TEST_PORT:'',STEAM_HTTP_PROXY:'',PORT:String(port),PUBLIC_ORIGIN:origin,HOST:'127.0.0.1',DATA_DIR:dir,BRIDGE_TOKEN:token},stdio:'ignore'});
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready);
 const runner=spawn('dotnet',['run','--project','game-bridge/tests/BridgeTests.csproj','--',origin,token,path.join(dir,'outbox.json'),m.map],{cwd:root,stdio:'inherit'});
 assert.equal(await new Promise(r=>runner.once('exit',r)),0);
 const verify=new DatabaseSync(path.join(dir,'arena.sqlite'));let saved=JSON.parse(verify.prepare('SELECT body FROM worlds WHERE id=?').get('ranked').body);
 assert.equal(saved.matches[0].phase,'settled');assert.equal(combatStats(saved,m.players[0]).adr,100);assert.equal(combatStats(saved,m.players[0]).kda,4);assert.equal(saved.ledger.length,12);
 assert.deepEqual(saved.matches[0].score,[4,5]);assert.equal(saved.matches[0].winner,1);assert.equal(saved.matches[0].legs.length,2);assert.equal(combatStats(saved,m.players[0]).rounds,10);assert.equal(saved.matches[0].combat.drawRounds,1);
 assert.equal(saved.matches[0].combat.version,2);assert.equal(saved.ledger[0].rule,'blmm-class-v1');assert.equal(saved.ledger[0].breakdown.factor,1.3);assert.equal(saved.ledger[0].breakdown.classes.cavalry,6);assert.equal(saved.ledger[0].breakdown.classes.infantry,4);assert.equal(saved.matches[0].combat.players[0].horseDamage,240);
 const replay=JSON.parse(saved.events.find(e=>JSON.parse(e.payload).type==='finished').payload);
 const post=body=>fetch(origin+'/api/bridge/events',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post(replay)).status,200);assert.equal((await post({...replay,score:[0,3]})).status,409);
 saved=JSON.parse(verify.prepare('SELECT body FROM worlds WHERE id=?').get('ranked').body);assert.equal(saved.ledger.length,12);verify.close();
 console.log('PASS: compiled C# transport -> Node HTTP -> SQLite settlement; retry did not duplicate points');
}finally{await new Promise(r=>{child.once('exit',r);child.kill();});await rm(dir,{recursive:true,force:true});}
