import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../engine.mjs';
import {adminAction,heartbeat} from '../operations.mjs';
import {ratingVisibility} from '../rating-visibility.mjs';
import {matchCue} from '../public/match-audio.js';
function fixture(){
 const s=g.empty();for(let i=0;i<12;i++){g.user(s,'p'+i,'P'+i);g.action(s,'p'+i,{type:'join'},1000);}
 const m=s.matches[0];m.players.forEach((id,i)=>{s.users[id].rating=1000+i*10;g.action(s,id,{type:'ready',matchId:m.id,revision:0},2000);});return {s,m};
}
function volunteer(s,m,id,type='captain-join',now=3000){g.action(s,id,{type,matchId:m.id,revision:0},now);}
test('captain selection ranks eligibility before an unbiased two-way team draw',()=>{
 const {s,m}=fixture();
 for(const candidates of [[],['p0'],['p0','p1'],['p0','p1','p2','p3']]){
  m.candidates=[...candidates];const snapshot=JSON.stringify(m);
  const expected=candidates.length>=2?[...candidates].reverse().slice(0,2):['p11','p10'];
  for(const coin of [0,1]){
   let draws=0;
   const captains=g.selectCaptains(s,m,max=>{assert.equal(max,2);draws++;return coin;});
   assert.equal(draws,1);assert.deepEqual(captains,coin===0?expected:[...expected].reverse());
   assert.equal(JSON.stringify(m),snapshot);
  }
 }
 s.users.p0.rating=s.users.p1.rating=s.users.p2.rating=1000;m.candidates=['p2','p0','p1'];
 assert.deepEqual(g.selectCaptains(s,m,()=>0),['p0','p1']);assert.deepEqual(g.selectCaptains(s,m,()=>1),['p1','p0']);
});
test('random captain teams survive reload without another draw',()=>{
 const {s,m}=fixture();g.tick(s,m.deadline);
 const captains=[...m.captains],restored=JSON.parse(JSON.stringify(s)),room=restored.matches[0];
 for(const id of room.players)g.action(restored,id,{type:'ready',matchId:room.id},33000);
 g.tick(restored,33000);
 assert.deepEqual(room.captains,captains);assert.deepEqual(room.teams,captains.map(id=>[id]));
 assert.deepEqual(room.pickOrder,[0,1,1,0,0,1,1,0,1,0]);assert.equal(room.turn,0);
});
for(const candidates of [[],['p0'],['p0','p1'],['p0','p1','p2','p3']])test(`captain election with ${candidates.length} volunteers uses the agreed fallback and ranking`,()=>{
 const {s,m}=fixture(),map=m.map;assert.equal(m.phase,'election');assert.equal(m.deadline,32000);assert(g.MAPS.some(x=>x.id===map));
 assert.equal(g.active(s,'p0'),m);assert.throws(()=>g.action(s,'p0',{type:'join'},2500),/比赛中/);
 assert.throws(()=>g.claim(s,{serverId:'s1',matchId:m.id,map},2500),/awaiting/);
 for(const id of candidates)volunteer(s,m,id);
 g.tick(s,31999);assert.equal(m.phase,'election');assert.deepEqual(m.captains,[]);
 g.tick(s,32000);assert.equal(m.phase,'draft');assert.equal(m.deadline,62000);
 assert.deepEqual([...m.captains].sort(),(candidates.length>=2?[...candidates].reverse().slice(0,2):['p11','p10']).sort());assert.deepEqual(m.teams,m.captains.map(id=>[id]));
 assert.equal(m.map,map);assert.equal(m.captainSelection,candidates.length>=2?'volunteers':'rating-fallback');
 for(let i=0;i<10;i++)g.tick(s,m.deadline);
 assert.equal(m.phase,'awaiting_server');assert.equal(m.map,map);assert(g.validCultures(m.cultures));assert.deepEqual(m.teams.map(t=>t.length),[6,6]);
});
test('independent candidacies accept stale snapshots, deduplicate, withdraw, and reject outsiders and late registrations',()=>{
 const {s,m}=fixture();g.user(s,'outsider','Visitor');
 assert.throws(()=>volunteer(s,m,'outsider'),/无法访问/);
 volunteer(s,m,'p0');volunteer(s,m,'p1');const revision=m.revision;
 volunteer(s,m,'p0');assert.equal(m.revision,revision);assert.deepEqual(m.candidates,['p0','p1']);
 volunteer(s,m,'p0','captain-withdraw');volunteer(s,m,'p0','captain-withdraw');assert.deepEqual(m.candidates,['p1']);
 assert.throws(()=>volunteer(s,m,'p2','captain-join',m.deadline),/已结束/);
 assert.throws(()=>volunteer(s,m,'p1','captain-withdraw',m.deadline),/已结束/);
 assert.throws(()=>g.action(s,'p0',{type:'demo-election',matchId:m.id,revision:m.revision},4000),/不支持/);
 const restored=JSON.parse(JSON.stringify(s)),room=restored.matches[0];g.tick(restored,room.deadline);
 assert.equal(room.map,m.map);assert.deepEqual([...room.captains].sort(),['p10','p11']);
 assert.throws(()=>volunteer(restored,room,'p0','captain-join',40000),/不在/);
});
test('tied volunteers resolve deterministically and do not expose ratings to players',()=>{
 const {s,m}=fixture();s.users.p0.rating=s.users.p1.rating=s.users.p2.rating=1000;
 for(const id of ['p2','p1','p0'])volunteer(s,m,id);
 const view=ratingVisibility({isAdmin:false,current:m,users:s.users});assert.equal(view.users.p0.rating,undefined);assert.deepEqual(view.current.candidates,['p2','p1','p0']);assert.equal(view.current.map,m.map);
 g.tick(s,m.deadline);assert.deepEqual([...m.captains].sort(),['p0','p1']);
});
test('election blocks manual map switching and remains cancellable without rating changes',()=>{
 const {s,m}=fixture();heartbeat(s,{serverId:'s1',idleMapSupported:true},3000);
 assert.throws(()=>adminAction(s,'owner',{type:'idle-map',serverId:'s1',map:g.MAPS[0].id},3001),/竞选/);
 adminAction(s,'owner',{type:'cancel',matchId:m.id,revision:m.revision,reason:'取消测试房间'},3002);
 assert.equal(m.phase,'cancelled');assert.equal(g.active(s,'p0'),undefined);assert.equal(s.ledger.length,0);
});
test('legacy draft gets a locked map without changing captain, pick order or deadline',()=>{
 const {s,m}=fixture();g.tick(s,m.deadline);delete m.map;const captains=[...m.captains],deadline=m.deadline,order=[...m.pickOrder];
 assert.equal(g.tick(s,33000),true);assert(g.MAPS.some(x=>x.id===m.map));assert.deepEqual(m.captains,captains);assert.deepEqual(m.pickOrder,order);assert.equal(m.deadline,deadline);
 const map=m.map;g.tick(s,34000);assert.equal(m.map,map);
});
test('election sounds once per room and transitions into draft/pick cues',()=>{
 const {m}=fixture(),state=current=>({me:{id:'p0'},mode:'ranked',current});
 const cue=matchCue(null,state(m));assert.equal(cue.kind,'election');assert.equal(matchCue(state(m),state({...m,candidates:['p1']})).key,cue.key);
 const draft={...m,phase:'draft',captains:['p1','p2'],turn:0};assert.equal(matchCue(state(m),state(draft)).kind,'draft');
 assert.equal(matchCue(state(m),state({...draft,captains:['p0','p2']})).kind,'pick');
});
