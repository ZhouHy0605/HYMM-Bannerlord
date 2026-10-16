import test from 'node:test';import assert from 'node:assert/strict';
import {PERFORMANCE_RULE,performanceRating} from '../rating.mjs';
import {validateCombat,mergeCombat} from '../combat.mjs';
import * as g from '../engine.mjs';import * as op from '../operations.mjs';
const ids=Array.from({length:12},(_,i)=>'p'+i),teams=[ids.slice(0,6),ids.slice(6)];
test('drawn rounds count toward statistics, but 2:2 never ends a leg or switches sides',()=>{
 const {s,m}=live();m.format='two-leg-v1';m.leg=0;m.legs=[];
 const first={...report(6),drawRounds:1};
 assert.throws(()=>g.finishLeg(s,m,[2,2],first),/三胜/);assert.equal(m.leg,0);assert.equal(s.ledger.length,0);
 g.finishLeg(s,m,[3,2],first);assert.equal(m.leg,1);assert.equal(m.phase,'awaiting_server');assert.equal(s.ledger.length,0);
 m.phase='live';g.finishLeg(s,m,[1,3],report(4));assert.deepEqual(m.score,[4,5]);assert.equal(m.combat.drawRounds,1);assert.equal(m.combat.players[0].rounds,10);assert.equal(s.ledger.length,12);
 for(const drawRounds of [-1,0,1.5,199,'1'])assert.throws(()=>validateCombat({...first,drawRounds},ids,[3,2]),/Invalid combat/);
 assert.equal(validateCombat(first,ids,[3,2]).drawRounds,1);
 const legacy={version:1,players:report().players};assert.throws(()=>validateCombat({...legacy,drawRounds:1},ids,[3,1]),/Invalid combat/);
});
function report(rounds=4){return {version:2,players:ids.map(id=>({id,kills:4,deaths:2,assists:2,damage:600,rounds,spawns:rounds,horseDamage:200,classes:{infantry:rounds,archer:0,cavalry:0}}))};}
function live(rule=PERFORMANCE_RULE){const s=g.empty();ids.forEach(id=>g.user(s,id,id));const m={id:'test-match',ratingRule:rule,players:ids,teams:structuredClone(teams),phase:'live',server:{id:'s1'},revision:0,timeline:[]};s.matches.push(m);return{s,m};}
function absent(p){Object.assign(p,{kills:0,deaths:0,assists:0,damage:0,horseDamage:0,spawns:0,classes:{infantry:0,archer:0,cavalry:0}});}
test('disconnected entire second half preserves first-half stats and settles all 12 once',()=>{
 const {s,m}=live();m.format='two-leg-v1';m.leg=0;m.legs=[];
 const first=report();first.players[0].classes={infantry:0,archer:0,cavalry:4};
 g.finishLeg(s,m,[3,1],first);m.phase='live';
 const second=report();absent(second.players[0]);g.finishLeg(s,m,[1,3],second);
 assert.equal(m.phase,'settled');assert.equal(s.ledger.length,12);
 const p=m.combat.players[0];assert.equal(p.rounds,8);assert.equal(p.kills,4);assert.equal(p.damage,600);assert.equal(p.spawns,4);
 assert.equal(m.ratingBreakdown.p0.factor,1.35);assert(Number.isFinite(m.changes.p0));
});
test('explicit zero activity is valid without inventing class evidence or survival points',()=>{
 const r=report();r.players.forEach(absent);const b=performanceRating(teams,[3,1],validateCombat(r,ids,[3,1]));
 assert.equal(b.p0.personal,0);assert.equal(b.p0.factor,1);assert.equal(b.p0.delta,40);assert.equal(b.p6.delta,-40);
 for(const key of ['kills','deaths','assists','damage','horseDamage']){const invalid=structuredClone(r);invalid.players[0][key]=1;assert.throws(()=>validateCombat(invalid,ids,[3,1]),/Invalid combat/);}
});
test('cavalry discounts positive delta and magnifies loss; mixed lives interpolate factor',()=>{
 const r=report();r.players[1].classes={infantry:0,archer:0,cavalry:4};r.players[2].classes={infantry:2,archer:0,cavalry:2};r.players[7].classes={infantry:0,archer:0,cavalry:4};
 const b=performanceRating(teams,[3,1],validateCombat(r,ids,[3,1]));
 // 2.5 kills + 9 survival + 7/6 assists + 600*40/5064 + 200*40/15192 = 17.93..., ceil 18.
 assert.equal(b.p0.personal,18);assert.equal(b.p0.delta,58);assert.equal(b.p1.base,58);assert.equal(b.p1.delta,43);assert.equal(b.p2.factor,1.175);assert.equal(b.p2.delta,49);
 assert.equal(b.p6.delta,-22);assert.equal(b.p7.delta,-30);assert.equal(b.p7.factor,1.35);
});
test('symmetrical teams have equal personal components, correct assist denominators, independent of ratings',()=>{
 const r=report();const b=performanceRating(teams,[2,2],r);assert.equal(b.p0.personal,b.p6.personal);assert.equal(b.p0.assists,7/6);assert.equal(b.p0.teamScore,0);assert.equal(b.p6.delta,18);
});
test('zero assists/damage remain finite; missing and inconsistent spawn evidence rejected',()=>{
 const r=report();r.players.forEach(p=>{p.assists=0;p.damage=0;p.horseDamage=0;});
 const b=performanceRating(teams,[3,1],validateCombat(r,ids,[3,1]));assert.equal(b.p0.assists,0);assert(Number.isFinite(b.p0.delta));
 for(const mutate of [p=>{p.spawns=0;},p=>{p.classes.cavalry=1;},p=>{delete p.horseDamage;},p=>{p.classes.archer=-1;},p=>{p.deaths=5;}]){const x=structuredClone(r);mutate(x.players[0]);assert.throws(()=>validateCombat(x,ids,[3,1]),/Invalid combat/);}
});
test('new rule stores breakdown and settles trusted report only once',()=>{
 const{s,m}=live();const payload={eventId:'finished-0001',type:'finished',matchId:m.id,serverId:'s1',score:[3,1],combat:report()};
 g.bridge(s,payload);g.bridge(s,payload);assert.equal(s.ledger.length,12);assert.equal(s.users.p0.rating,1058);assert.equal(s.ledger[0].rule,PERFORMANCE_RULE);assert.equal(s.ledger[0].breakdown.base,58);assert.equal(m.combat.version,2);
});
test('missing v2 evidence enters review; no fallback to guessed infantry and no manual score-only bypass',()=>{
 const{s,m}=live();m.startedAt=1;g.bridge(s,{eventId:'missing-stats',type:'finished',matchId:m.id,serverId:'s1',score:[3,1]});
 assert.equal(m.phase,'review');assert.equal(m.failureReason,'combat_v2_required');assert.deepEqual(m.pendingResult.score,[3,1]);assert.equal(s.ledger.length,0);
 assert.throws(()=>op.adminAction(s,'admin',{type:'settle',matchId:m.id,revision:m.revision,score:[3,1],reason:'仅有比赛比分没有兵种明细'}),/完整兵种/);assert.equal(s.users.p0.rating,1000);
});
test('two legs aggregate class proportions before rating; legacy matches retain Elo',()=>{
 const{s,m}=live();m.format='two-leg-v1';m.leg=0;m.legs=[];
 const first=report();first.players[0].classes={infantry:0,archer:0,cavalry:4};g.finishLeg(s,m,[3,1],first);assert.equal(s.ledger.length,0);
 m.phase='live';g.finishLeg(s,m,[3,1],report());assert.equal(m.ratingBreakdown.p0.factor,1.175);assert.equal(m.ratingBreakdown.p0.spawns,8);assert.deepEqual(m.combat.players[0].classes,{infantry:4,archer:0,cavalry:4});assert.equal(s.ledger.length,12);
 const old=live('elo-team-v1');g.finishLeg(old.s,old.m,[3,1],report());assert.equal(old.s.users.p0.rating,1016);assert.equal(old.m.ratingBreakdown,undefined);
});
test('rule is captured when room is created, not changed mid-match',()=>{
 const s=g.empty();s.ratingRule=PERFORMANCE_RULE;ids.forEach(id=>{g.user(s,id,id);g.action(s,id,{type:'join'},1000);});assert.equal(s.matches[0].ratingRule,PERFORMANCE_RULE);s.ratingRule='elo-team-v1';assert.equal(s.matches[0].ratingRule,PERFORMANCE_RULE);
});

test('archers and mixed classes use weighted factors for both wins and losses',()=>{
 const r=report();
 for(const i of [0,6])r.players[i].classes={infantry:0,archer:4,cavalry:0};
 for(const i of [1,7])r.players[i].classes={infantry:0,archer:2,cavalry:2};
 for(const i of [2,8])r.players[i].classes={infantry:2,archer:2,cavalry:0};
 const b=performanceRating(teams,[3,1],validateCombat(r,ids,[3,1]));
 assert.equal(b.p0.factor,1.15);assert.equal(b.p0.archerShare,1);assert.equal(b.p0.delta,50);assert.equal(b.p6.delta,-25);
 assert.equal(b.p1.factor,1.25);assert.equal(b.p1.delta,46);assert.equal(b.p7.delta,-28);
 assert.equal(b.p2.factor,1.075);assert.equal(b.p2.delta,54);assert.equal(b.p8.delta,-24);
});

test('existing v1 rooms retain cavalry 1.5 and archer 1, and cannot bypass evidence checks',()=>{
 const {s,m}=live('blmm-class-v1'),r=report();
 r.players[0].classes={infantry:0,archer:0,cavalry:4};
 r.players[1].classes={infantry:0,archer:4,cavalry:0};
 s.ratingRule=PERFORMANCE_RULE;
 g.finishLeg(s,m,[3,1],r);
 assert.equal(m.ratingBreakdown.p0.factor,1.5);assert.equal(m.changes.p0,39);
 assert.equal(m.ratingBreakdown.p1.factor,1);assert.equal(m.changes.p1,58);
 assert.equal(s.ledger[0].rule,'blmm-class-v1');
 for(const rule of ['blmm-class-v1',PERFORMANCE_RULE]){
  const x=live(rule);x.m.phase='review';x.m.startedAt=1;
  assert.throws(()=>op.adminAction(x.s,'admin',{type:'settle',matchId:x.m.id,revision:0,score:[3,1],reason:'仅有比赛比分没有兵种明细'}),/完整兵种/);
 }
});
test('mixing legacy and v2 legs never fabricates class evidence',()=>{
 const a=report(),b=report();b.version=1;const merged=mergeCombat([{combat:a},{combat:b}],ids);assert.equal(merged.version,1);assert.equal(merged.players[0].classes,undefined);
});
