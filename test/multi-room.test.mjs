import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../engine.mjs';
function queue(n){const s=g.empty();for(let i=0;i<n;i++){const id='p'+i;g.user(s,id,id);s.queue.push({id,at:1000});}return s;}
function prepare(s,m){g.action(s,m.players[0],{type:'demo-ready',matchId:m.id,revision:m.revision},2000,true);for(let i=0;i<10;i++)g.tick(s,m.deadline+1);}
test('24 / 36 players form disjoint rooms in one pass, leftovers stay queued',()=>{
 for(const n of [24,25,36,40]){const s=queue(n);g.pair(s,1000);assert.equal(s.matches.length,Math.floor(n/12));assert.equal(s.queue.length,n%12);const ids=s.matches.flatMap(m=>m.players);assert.equal(new Set(ids).size,ids.length);assert.equal(new Set(s.matches.map(m=>m.number)).size,s.matches.length);assert.equal(g.pair(s,1000),undefined);}
});
test('one high-rated player does not block a full eligible table, waiting widens Elo band',()=>{
 const s=queue(13);s.users.p0.rating=3000;g.pair(s,1000);assert.equal(s.matches.length,1);assert.deepEqual(s.queue.map(q=>q.id),['p0']);
 const t=queue(12);t.users.p0.rating=1800;g.pair(t,1000);assert.equal(t.matches.length,0);g.tick(t,361000);assert.equal(t.matches.length,1);
});
test('random choice excludes mirror cultures and survives reload/ticks, legacy ban phase migrates',()=>{
 const s=queue(12);g.pair(s,1000);const m=s.matches[0];m.phase='veto';m.deadline=0;
 g.prepareBattle(m,2000,()=>0);assert.equal(m.map,g.MAPS[0].id);assert.deepEqual(m.cultures,[g.CULTURES[0].id,g.CULTURES[1].id]);
 const saved=JSON.parse(JSON.stringify(s));g.tick(saved,3000);assert.deepEqual(saved.matches[0],m);
 g.prepareBattle(m,4000,()=>{throw Error('must not reroll');});assert.equal(m.selection.at,2000);
 m.phase='veto';delete m.cultures;g.tick(s,5000);assert.equal(m.phase,'awaiting_server');assert.equal(m.map,g.MAPS[0].id);assert.equal(m.cultures.length,2);
 assert.throws(()=>g.action(s,'p0',{type:'ban',matchId:m.id,revision:m.revision}),/不支持/);
});
test('two servers claim/settle independent tables; double booking and wrong cultures fail',()=>{
 const s=queue(24);g.pair(s,1000);for(const m of s.matches)g.action(s,m.players[0],{type:'demo-ready',matchId:m.id,revision:m.revision},2000,true);for(let i=0;i<10;i++)g.tick(s,s.matches[0].deadline+1);const [a,b]=s.matches;
 g.claim(s,{matchId:a.id,map:a.map,serverId:'s1'});
 assert.throws(()=>g.claim(s,{matchId:a.id,map:a.map,serverId:'s2'}),/reserved/);
 assert.throws(()=>g.claim(s,{matchId:b.id,map:b.map,serverId:'s1'}),/occupied/);
 g.claim(s,{matchId:b.id,map:b.map,serverId:'s2'});
 for(const [m,serverId] of [[a,'s1'],[b,'s2']]){const start={eventId:m.id+':started',type:'started',matchId:m.id,serverId,map:m.map,teams:m.teams,cultures:m.cultures};assert.throws(()=>g.bridge(s,{...start,cultures:['invalid','invalid']}),/mismatch/);g.bridge(s,start);}
 const end={eventId:a.id+':finished',type:'finished',matchId:a.id,serverId:'s1',score:[3,2]};g.bridge(s,end);g.bridge(s,end);assert.equal(s.ledger.length,12);assert.equal(b.phase,'live');assert.deepEqual(a.ratings[a.teams[0][0]],{before:1000,after:1016});
 g.bridge(s,{eventId:b.id+':finished',type:'finished',matchId:b.id,serverId:'s2',score:[1,3]});assert.equal(s.ledger.length,24);assert.equal(s.matches.filter(m=>m.phase==='settled').length,2);
});
test('24-person rehearsal opens two rooms and only waits for the human ready check',()=>{
 const s=g.empty();g.user(s,'human','测试');g.fillDemo24(s,'human',1000);assert.equal(s.matches.length,2);assert.equal(s.queue.length,0);assert.equal(g.active(s,'human').ready.length,11);assert.equal(s.matches.find(m=>!m.players.includes('human')).phase,'awaiting_server');
});
test('all 30 ordered culture pairings are distinct; old unclaimed mirror rooms migrate safely',()=>{
 const pairs=new Set();for(let a=0;a<6;a++)for(let b=0;b<5;b++){
  const s=queue(12);g.pair(s,1000);const m=s.matches[0];m.map=g.MAPS[0].id;const draws=[a,b];g.prepareBattle(m,2000,n=>{const v=draws.shift();assert.ok(v<n);return v;});
  assert(g.validCultures(m.cultures));pairs.add(m.cultures.join('/'));
 }assert.equal(pairs.size,30);
 const s=queue(24);g.pair(s,1000);const [a,b]=s.matches;
 for(const m of [a,b]){m.phase='awaiting_server';m.deadline=0;m.map=g.MAPS[0].id;m.cultures=['empire','empire'];}
 b.reservation={serverId:'existing-server',at:1000};
 assert.throws(()=>g.claim(s,{matchId:a.id,map:a.map,serverId:'s1'}),/distinct/);
 g.tick(s,3000);assert.equal(a.cultures[0],'empire');assert.notEqual(a.cultures[1],'empire');assert.equal(a.map,g.MAPS[0].id);assert.equal(a.phase,'awaiting_server');
 assert.equal(b.phase,'review');assert.deepEqual(b.cultures,['empire','empire']);assert.equal(s.ledger.length,0);
});
