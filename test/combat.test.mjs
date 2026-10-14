import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCombat,combatStats,mergeCombat} from '../combat.mjs';
import {steamProfile,safeAvatar} from '../steam-profile.mjs';
import * as g from '../engine.mjs';
function live(){const s=g.empty();const ids=Array.from({length:12},(_,i)=>String(i));ids.forEach(id=>g.user(s,id,id));const m={id:'match',players:ids,teams:[ids.slice(0,6),ids.slice(6)],phase:'live',server:{id:'s1'},revision:0,timeline:[]};s.matches.push(m);return {s,m};}
const report=m=>({version:1,players:m.players.map(id=>({id,kills:4,deaths:2,assists:3,damage:500,rounds:4}))});
test('combat reports settle atomically and repeated events do not duplicate totals',()=>{
 const {s,m}=live(),b={eventId:'result-0001',type:'finished',matchId:m.id,serverId:'s1',score:[3,1],combat:report(m)};
 const bad=structuredClone(b);bad.combat.players[11].id='0';assert.throws(()=>g.bridge(s,bad),/Invalid combat/);assert.equal(m.phase,'live');assert.equal(s.ledger.length,0);
 g.bridge(s,b);g.bridge(s,b);assert.deepEqual(combatStats(s,'0'),{matches:1,rounds:4,kills:4,deaths:2,assists:3,damage:500,horseDamage:0,score:500,scoreEstimatedMatches:1,adr:125,kd:2,kda:3.5});assert.equal(s.ledger.length,12);
});
test('missing data is unavailable, ratios use total rounds and zero death denominator is one',()=>{
 const {s,m}=live();assert.equal(combatStats(s,'0').adr,null);
 m.phase='settled';m.combat=report(m);m.combat.players[0].deaths=0;
 const n=structuredClone(m);n.id='second';n.combat.players[0].rounds=5;n.combat.players[0].damage=400;s.matches.push(n);
 assert.equal(combatStats(s,'0').adr,100);assert.equal(combatStats(s,'0').kd,8);
 const p=report(m);p.players[0].damage=-1;assert.throws(()=>validateCombat(p,m.players,[3,1]));p.players[0].damage=0;p.players[0].rounds=3;assert.throws(()=>validateCombat(p,m.players,[3,1]));
});
test('Steam profile sync validates identity, avatar hosts, and falls back on API failure',async()=>{
 const id='76561198000000001';const mock=async()=>({ok:true,json:async()=>({response:{players:[{steamid:id,personaname:'骑士',avatarfull:'https://avatars.steamstatic.com/a.jpg'}]}})});
 const p=await steamProfile(id,'test-key',mock);assert.equal(p.name,'骑士');assert.equal(p.avatar,'https://avatars.steamstatic.com/a.jpg');
 assert.equal(await steamProfile('wrong','test-key',mock),null);assert.equal(await steamProfile(id,'',mock),null);assert.equal(await steamProfile(id,'test',async()=>{throw Error('offline');}),null);
 assert.equal(safeAvatar('https://evil.test/a.jpg'),null);assert.equal(safeAvatar('https://avatars.steamstatic.com.evil.test/a.jpg'),null);assert.equal(safeAvatar('javascript:alert(1)'),null);
});
test('ADR uses native scoreboard totals including deductions, with weighted rounds across both halves',()=>{
 const {s,m}=live();
 const first=report(m),second=report(m);
 for(const p of first.players){p.nativeScore=95;}
 for(const p of second.players){p.nativeScore=-15;p.rounds=3;}
 const a=validateCombat(first,m.players,[3,1]),b=validateCombat(second,m.players,[0,3]);
 m.phase='settled';m.combat=mergeCombat([{combat:a},{combat:b}],m.players);
 const stats=combatStats(s,'0');
 assert.equal(stats.score,80);assert.equal(stats.adr,80/7);assert.equal(stats.scoreEstimatedMatches,0);
 assert.equal(stats.damage,1000);assert.equal(stats.kd,2);
 const unfinished=structuredClone(m);unfinished.phase='cancelled';s.matches.push(unfinished);
 assert.equal(combatStats(s,'0').score,80);
});
test('legacy horse damage is weighted 35 percent and explicitly marked estimated',()=>{
 const {s,m}=live();m.phase='settled';m.combat=report(m);
 m.combat.players[0].horseDamage=200;
 const stats=combatStats(s,'0');assert.equal(stats.adr,142.5);assert.equal(stats.scoreEstimatedMatches,1);
 m.combat.players[0].nativeScore=0;
 assert.equal(combatStats(s,'0').adr,0);assert.equal(combatStats(s,'0').scoreEstimatedMatches,0);
});
test('native score preserves signed integers and rejects invalid values',()=>{
 const {m}=live();const r=report(m);r.players[0].nativeScore=-45;
 assert.equal(validateCombat(r,m.players,[3,1]).players[0].nativeScore,-45);
 for(const value of [null,NaN,1.5,'100',1000001,-1000001]){r.players[0].nativeScore=value;assert.throws(()=>validateCombat(r,m.players,[3,1]),/Invalid combat/);}
});
