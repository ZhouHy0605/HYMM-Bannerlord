import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../engine.mjs';
import {heartbeat} from '../operations.mjs';
function fixture(){const s=g.empty();for(let i=0;i<12;i++){const id=String(76561198000000000n+BigInt(i));g.user(s,id,'Player '+i);g.action(s,id,{type:'join'},1000);}const m=s.matches[0];g.action(s,m.players[0],{type:'demo-ready',matchId:m.id,revision:m.revision},2000,true);for(let i=0;i<10;i++)g.tick(s,m.deadline+1);return {s,m};}
test('exclusive claim, same-server retry and reservation-aware start',()=>{
 const {s,m}=fixture(),b={matchId:m.id,map:m.map,serverId:'s1'};
 assert.equal(g.claim(s,b).reservedBy,'s1');assert.deepEqual(g.claim(s,b),g.job(m));
 assert.throws(()=>g.claim(s,{...b,serverId:'s2'}),/reserved/);
 assert.throws(()=>g.bridge(s,{eventId:'start-foreign',type:'started',...b,serverId:'s2',teams:m.teams,cultures:m.cultures}),/reserved/);
 g.bridge(s,{eventId:'start-owner',type:'started',...b,teams:m.teams,cultures:m.cultures});assert.equal(m.phase,'live');
});
test('failed preparation enters review without points and keeps server reserved',()=>{
 const {s,m}=fixture();g.claim(s,{matchId:m.id,map:m.map,serverId:'s1'});
 g.bridge(s,{eventId:'failure-preparation',type:'failed',matchId:m.id,serverId:'s1',reason:'map_preparation_timeout'});
 assert.equal(m.phase,'review');assert.equal(m.failureReason,'map_preparation_timeout');assert.equal(s.ledger.length,0);
 const other=fixture().m;s.matches.push(other);assert.throws(()=>g.claim(s,{matchId:other.id,map:other.map,serverId:'s1'}),/occupied/);
});
test('arrival timeout cancels without stats changes and releases only after stop acknowledgement',()=>{
 const {s,m}=fixture();g.claim(s,{matchId:m.id,map:m.map,serverId:'s1'});
 const users=JSON.stringify(s.users),b={eventId:'arrival-timeout-1',type:'failed',matchId:m.id,serverId:'s1',reason:'arrival_timeout'};
 g.bridge(s,b,500000);assert.equal(m.phase,'cancelled');assert.equal(m.finishedAt,500000);assert.equal(s.ledger.length,0);assert.equal(JSON.stringify(s.users),users);
 const control=s.controls.s1;g.bridge(s,b);assert.equal(s.controls.s1.id,control.id);
 g.bridge(s,{eventId:'late-start-cancelled',type:'started',matchId:m.id,serverId:'s1',map:m.map,teams:m.teams,cultures:m.cultures});assert.equal(m.phase,'cancelled');
 const other=fixture().m;s.matches.push(other);assert.throws(()=>g.claim(s,{matchId:other.id,map:other.map,serverId:'s1'}),/acknowledgement/);
 heartbeat(s,{serverId:'s1',matchId:null,ackId:control.id});assert.equal(g.claim(s,{matchId:other.id,map:other.map,serverId:'s1'}).matchId,other.id);
});
test('arrival timeout after play has started remains review, not automatic cancellation',()=>{
 const {s,m}=fixture();g.claim(s,{matchId:m.id,map:m.map,serverId:'s1'});
 g.bridge(s,{eventId:'started-existing',type:'started',matchId:m.id,serverId:'s1',map:m.map,teams:m.teams,cultures:m.cultures});
 g.bridge(s,{eventId:'late-arrival-failure',type:'failed',matchId:m.id,serverId:'s1',reason:'arrival_timeout'});assert.equal(m.phase,'review');assert.equal(s.controls?.s1,undefined);
});
export {fixture};
