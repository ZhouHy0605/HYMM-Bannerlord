import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../engine.mjs';
function setup(){const s=g.empty();for(let i=0;i<12;i++){g.user(s,'p'+i,'骑士'+i);g.action(s,'p'+i,{type:'join'},1000);}return s;}
function ready(s){const m=s.matches[0];for(const id of m.players)g.action(s,id,{type:'ready',matchId:m.id,revision:m.revision},2000);g.tick(s,m.deadline);return m;}
function draft(s,m){for(let i=0;i<10;i++){const id=m.players.find(p=>!m.teams.flat().includes(p));g.action(s,m.captains[m.turn],{type:'pick',playerId:id,matchId:m.id,revision:m.revision},3000);}}
test('12 unique players -> balanced roster -> random map/cultures -> trusted result, exactly once',()=>{
 const s=setup(),m=ready(s);draft(s,m);assert.equal(m.phase,'awaiting_server');assert.deepEqual(m.teams.map(t=>t.length),[6,6]);assert.equal(new Set(m.teams.flat()).size,12);assert.ok(g.MAPS.some(x=>x.id===m.map));assert.equal(m.cultures.length,2);
 const started={eventId:'start-001',type:'started',matchId:m.id,serverId:'cloud-1',map:m.map,teams:m.teams,cultures:m.cultures};g.claim(s,started);g.bridge(s,started,5000);
 const end={eventId:'finish-001',type:'finished',matchId:m.id,serverId:'cloud-1',score:[3,1]};g.bridge(s,end,6000);g.bridge(s,end,7000);
 assert.equal(s.ledger.length,12);assert.equal(s.users[m.teams[0][0]].rating,1016);assert.equal(s.users[m.teams[1][0]].rating,984);assert.equal(s.ledger.reduce((n,l)=>n+l.delta,0),0);
 assert.throws(()=>g.bridge(s,{...end,score:[1,3]},8000),/conflict/);
});
test('unauthorized picks, stale revisions, duplicates and forged roster are rejected',()=>{
 const s=setup(),m=ready(s),candidate=m.players.find(id=>!m.captains.includes(id));
 assert.throws(()=>g.action(s,candidate,{type:'pick',matchId:m.id,revision:m.revision,playerId:candidate}),/轮到/);
 assert.throws(()=>g.action(s,m.captains[0],{type:'pick',matchId:m.id,revision:-1,playerId:candidate}),/更新/);
 assert.throws(()=>g.action(s,m.captains[0],{type:'pick',matchId:m.id,revision:m.revision,playerId:m.captains[0]}),/选择/);
 draft(s,m);g.claim(s,{matchId:m.id,serverId:'s1',map:m.map});assert.throws(()=>g.bridge(s,{eventId:'wrong-001',type:'started',matchId:m.id,serverId:'s1',map:m.map,teams:[]}),/mismatch/);
});
test('ready timeout preserves priority and lets absentees rejoin immediately',()=>{
 const s=setup(),m=s.matches[0];g.action(s,'p0',{type:'ready',matchId:m.id,revision:m.revision},2000);g.tick(s,62000);
 assert.equal(m.phase,'cancelled');assert.equal(s.queue[0].id,'p0');assert.equal(s.users.p1.cooldown,0);assert.equal(s.queue.some(q=>q.id==='p1'),false);g.action(s,'p1',{type:'join'},62000);assert.deepEqual(s.queue.map(q=>q.id),['p0','p1']);assert.equal(s.queue[0].at,m.createdAt);assert.equal(s.ledger.length,0);assert.ok(Object.values(s.users).every(u=>u.rating===1000&&u.losses===0));
});
test('timeouts automatically advance draft without duplicate picks',()=>{
 const s=setup(),m=ready(s);for(let i=0;i<10;i++)g.tick(s,m.deadline+1);assert.equal(m.phase,'awaiting_server');assert.equal(new Set(m.teams.flat()).size,12);assert.deepEqual(m.picks.map(p=>p.team),[0,1,1,0,0,1,1,0,1,0]);assert.deepEqual(m.teams.map(t=>t.length),[6,6]);
});
test('ABBAABBABA draft enforces every turn and rejects the other captain',()=>{
 const s=setup(),m=ready(s),expected=[0,1,1,0,0,1,1,0,1,0];
 for(const team of expected){
  assert.equal(m.turn,team);const playerId=m.players.find(id=>!m.teams.flat().includes(id));
  const request={type:'pick',matchId:m.id,revision:m.revision,playerId};
  assert.throws(()=>g.action(s,m.captains[1-team],request,3000),/轮到/);
  g.action(s,m.captains[team],request,3000);
 }
 assert.deepEqual(m.picks.map(p=>p.team),expected);assert.deepEqual(m.teams.map(t=>t.length),[6,6]);assert.equal(m.phase,'awaiting_server');
});
test('persisted previous snake drafts keep their remaining turns after restart',()=>{
 const s=setup(),m=ready(s),previous=[0,1,1,0,0,1,1,0,0,1];m.pickOrder=[...previous];
 for(let i=0;i<8;i++)g.tick(s,m.deadline);
 const restored=JSON.parse(JSON.stringify(s)),match=restored.matches[0];
 for(let i=8;i<10;i++)g.tick(restored,match.deadline);
 assert.deepEqual(match.picks.map(p=>p.team),previous);assert.deepEqual(match.teams.map(t=>t.length),[6,6]);assert.equal(match.phase,'awaiting_server');
});
test('persisted legacy drafts retain alternating order after restart',()=>{
 const s=setup(),m=ready(s);delete m.pickOrder;
 for(let i=0;i<3;i++){const playerId=m.players.find(id=>!m.teams.flat().includes(id));g.action(s,m.captains[m.turn],{type:'pick',matchId:m.id,revision:m.revision,playerId},3000);}
 const restored=JSON.parse(JSON.stringify(s)),match=restored.matches[0];
 for(let i=3;i<10;i++)g.tick(restored,match.deadline+1);
 assert.deepEqual(match.picks.map(p=>p.team),[0,1,0,1,0,1,0,1,0,1]);assert.deepEqual(match.teams.map(t=>t.length),[6,6]);
});
test('only demo permits manual results; wrong scores and server identities cannot settle',()=>{
 const s=setup(),m=ready(s);draft(s,m);assert.throws(()=>g.action(s,'p0',{type:'demo-start',matchId:m.id,revision:m.revision}),/不支持/);
 g.claim(s,{matchId:m.id,serverId:'s',map:m.map});g.bridge(s,{eventId:'start-002',type:'started',matchId:m.id,serverId:'s',map:m.map,teams:m.teams,cultures:m.cultures});
 assert.throws(()=>g.settle(s,m,[3,3]),/比分/);assert.throws(()=>g.bridge(s,{eventId:'finish-002',type:'finished',matchId:m.id,serverId:'intruder',score:[3,0]}),e=>e.status===403);assert.equal(s.ledger.length,0);
});
test('queue joins are idempotent and one player cannot enter two active matches',()=>{const s=g.empty();g.user(s,'a','A');for(let i=0;i<3;i++)g.action(s,'a',{type:'join'},1000);assert.equal(s.queue.length,1);g.fillDemo(s,'a',1000);assert.throws(()=>g.action(s,'a',{type:'join'}),/比赛中/);});

test('all twelve can confirm the same ready snapshot without stale-revision failures',()=>{
 const s=setup(),m=s.matches[0],revision=m.revision;
 for(const id of m.players)g.action(s,id,{type:'ready',matchId:m.id,revision},2000);
 assert.equal(m.phase,'election');assert.equal(m.ready.length,12);
 const after=m.revision;
 g.action(s,m.players[0],{type:'ready',matchId:m.id,revision},2001);
 assert.equal(m.revision,after);assert.equal(m.ready.length,12);
 g.tick(s,m.deadline);
 const playerId=m.players.find(id=>!m.captains.includes(id));
 assert.throws(()=>g.action(s,m.captains[0],{type:'pick',matchId:m.id,revision,playerId},2002),/更新/);
});

test('ready cannot be confirmed at or after deadline even before the expiry tick',()=>{
 const s=setup(),m=s.matches[0];
 assert.throws(()=>g.action(s,'p0',{type:'ready',matchId:m.id,revision:m.revision},m.deadline),/超时/);
 assert.deepEqual(m.ready,[]);
 assert.throws(()=>g.action(s,'outsider',{type:'ready',matchId:m.id,revision:m.revision},2000));
});

test('ready confirmation expires at 45 seconds without a requeue penalty',()=>{const s=setup(),m=s.matches[0];assert.equal(m.deadline-m.createdAt,45000);g.action(s,'p0',{type:'ready',matchId:m.id,revision:m.revision},m.createdAt+1000);g.tick(s,m.createdAt+44999);assert.equal(m.phase,'ready');g.tick(s,m.createdAt+45000);assert.equal(m.phase,'cancelled');assert.equal(s.queue[0].id,'p0');assert.equal(s.users.p1.cooldown,0);g.action(s,'p1',{type:'join'},m.createdAt+45000);assert.equal(s.queue[1].id,'p1');});

test('a legacy ready cooldown cannot block a new queue entry',()=>{const s=g.empty();g.user(s,'legacy','Legacy').cooldown=999999;g.action(s,'legacy',{type:'join'},1000);g.action(s,'legacy',{type:'join'},1001);assert.equal(s.queue.length,1);assert.equal(s.queue[0].id,'legacy');});
