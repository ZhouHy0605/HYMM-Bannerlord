import test from 'node:test';import assert from 'node:assert/strict';
import * as g from '../engine.mjs';import * as op from '../operations.mjs';
function setup(){const s=g.empty();s.matchFormat='two-leg-v1';for(let i=0;i<12;i++){g.user(s,'p'+i,'P'+i);g.action(s,'p'+i,{type:'join'},1000);}const m=s.matches[0];g.action(s,'p0',{type:'demo-ready',matchId:m.id,revision:m.revision},2000,true);for(let i=0;i<11;i++)g.tick(s,m.deadline+1);g.claim(s,{matchId:m.id,map:m.map,serverId:'s1'},400000);return{s,m};}
function start(s,m){g.bridge(s,{eventId:`${m.id}:leg${m.leg}:started`,type:'started',leg:m.leg,matchId:m.id,serverId:'s1',map:m.map,teams:m.teams,cultures:m.cultures},400100);}
test('idle map commands serialize with claims, require loaded-map acknowledgement and preserve scores',()=>{
 const s=g.empty(),map=g.MAPS[0].id,now=500000;
 op.heartbeat(s,{serverId:'s1',idleMapSupported:true},now);
 op.adminAction(s,'owner',{type:'idle-map',serverId:'s1',map},now);
 const c=s.controls.s1;assert.equal(c.status,'pending');assert.equal(s.audit[0].actor,'owner');
 assert.throws(()=>g.claim(s,{serverId:'s1',matchId:'anything',map},now),/awaiting stop/);
 assert.throws(()=>op.adminAction(s,'owner',{type:'idle-map',serverId:'s1',map},now),/已有操作/);
 assert.throws(()=>op.heartbeat(s,{serverId:'s1',ackId:c.id,controlResult:'ok',currentMap:'wrong'},now+1),/mismatch/);
 op.heartbeat(s,{serverId:'s1',ackId:c.id,controlResult:'ok',currentMap:map,idleMapSupported:true},now+2);
 assert.equal(c.status,'acknowledged');assert.equal(s.ledger.length,0);
 op.adminAction(s,'owner',{type:'idle-map',serverId:'s1',map},now+3);
 op.heartbeat(s,{serverId:'s1',ackId:s.controls.s1.id,controlResult:'failed',controlError:'map_load_timeout'},now+4);
 assert.equal(s.controls.s1.status,'failed');
});
test('idle maps refuse occupied, blocked, stale or unsupported servers and invalid maps',()=>{
 const {s,m}=setup(),map=g.MAPS[0].id,b={type:'idle-map',serverId:'s1',map};
 op.heartbeat(s,{serverId:'s1',idleMapSupported:true},500000);assert.throws(()=>op.adminAction(s,'owner',b,500001),/占用/);
 m.phase='cancelled';op.heartbeat(s,{serverId:'s1',blocked:true,idleMapSupported:true},500001);assert.throws(()=>op.adminAction(s,'owner',b,500002),/阻塞/);
 op.heartbeat(s,{serverId:'s1'},500002);assert.throws(()=>op.adminAction(s,'owner',b,500003),/不支持/);
 op.heartbeat(s,{serverId:'s1',idleMapSupported:true},500003);assert.throws(()=>op.adminAction(s,'owner',b,530004),/过期/);
 assert.throws(()=>op.adminAction(s,'owner',{...b,map:'unknown'},500004),/可用地图/);
 m.phase='awaiting_server';delete m.reservation;delete m.server;assert.throws(()=>op.adminAction(s,'owner',b,500004),/等待服务器/);
});
test('drafting locks manual map switches globally before any server reservation exists',()=>{
 const {s,m}=setup();m.phase='draft';delete m.reservation;delete m.server;
 op.heartbeat(s,{serverId:'s2',idleMapSupported:true},500000);
 assert.throws(()=>op.adminAction(s,'owner',{type:'idle-map',serverId:'s2',map:g.MAPS[0].id},500001),/竞选队长或选人/);
 assert.equal(s.controls?.s2,undefined);
});
function report(s,m,score){const b={eventId:`${m.id}:leg${m.leg}:finished`,type:'finished',leg:m.leg,matchId:m.id,serverId:'s1',score,combat:{version:1,players:m.players.map(id=>({id,kills:4,deaths:2,assists:2,damage:400,rounds:score[0]+score[1]}))}};g.bridge(s,b,400200);return b;}
test('two legs preserve A/B identities, reserve the server, aggregate combat and settle only once',()=>{const{s,m}=setup();start(s,m);const first=report(s,m,[3,1]);assert.equal(m.phase,'awaiting_server');assert.equal(m.leg,1);assert.equal(s.ledger.length,0);assert.equal(g.job(m).reservedBy,'s1');g.bridge(s,first);assert.equal(m.legs.length,1);assert.throws(()=>g.bridge(s,{...first,eventId:'wrong-round'}),/leg mismatch/);start(s,m);const second=report(s,m,[1,3]);assert.deepEqual(m.score,[4,4]);assert.equal(m.winner,null);assert.equal(s.users.p0.draws,1);assert.equal(s.ledger.length,12);assert.equal(m.combat.players[0].rounds,8);assert.equal(m.combat.players[0].damage,800);g.bridge(s,second);assert.equal(s.ledger.length,12);});
test('second leg winner uses total rounds rather than winner of last leg',()=>{const{s,m}=setup();start(s,m);report(s,m,[3,0]);start(s,m);report(s,m,[2,3]);assert.deepEqual(m.score,[5,3]);assert.equal(m.winner,0);assert.equal(s.ledger.length,12);});
test('cancel retains an explicit stop until heartbeat acknowledgement, records audit and rejects stale writes',()=>{const{s,m}=setup();start(s,m);const old=m.revision;op.adminAction(s,'owner',{type:'cancel',matchId:m.id,revision:old,reason:'玩家报告本场无法继续'},500000);assert.equal(m.phase,'cancelled');assert.equal(s.ledger.length,0);assert.equal(s.audit.length,1);assert(op.pendingControl(s,'s1'));assert.throws(()=>op.adminAction(s,'owner',{type:'cancel',matchId:m.id,revision:old,reason:'重复取消不应生效'}));const control=op.heartbeat(s,{serverId:'s1',matchId:m.id},500001).control;assert.throws(()=>op.heartbeat(s,{serverId:'s1',matchId:m.id,ackId:control.id},500002));op.heartbeat(s,{serverId:'s1',matchId:null,ackId:control.id},500003);assert(!op.pendingControl(s,'s1'));g.bridge(s,{eventId:'late-finished',type:'finished',matchId:m.id,serverId:'s1',leg:0,score:[3,0]},500004);assert.equal(s.ledger.length,0);assert(s.events.at(-1).ignored);});
test('heartbeat timeout enters review and manual two-leg resolution cannot replace recorded first-leg evidence',()=>{const{s,m}=setup();start(s,m);report(s,m,[3,1]);start(s,m);op.heartbeat(s,{serverId:'s1',matchId:m.id},500000);op.monitor(s,590001);assert.equal(m.phase,'review');assert.equal(m.failureReason,'heartbeat_timeout');assert.throws(()=>op.adminAction(s,'owner',{type:'settle',matchId:m.id,revision:m.revision,reason:'核实两轮比赛日志',legs:[[0,3],[3,1]]}),/冲突/);op.adminAction(s,'owner',{type:'settle',matchId:m.id,revision:m.revision,reason:'双方确认并核对服务器日志',legs:[[3,1],[3,2]]},600000);assert.deepEqual(m.score,[6,3]);assert.equal(m.phase,'settled');assert.equal(s.ledger.length,12);assert.equal(s.audit.length,1);assert.equal(s.ledger[0].source,'admin');});
test('unstarted matches cannot be manually scored and untrusted scores cannot change points',()=>{const{s,m}=setup();op.adminAction(s,'owner',{type:'review',matchId:m.id,revision:m.revision,reason:'服务器尚未启动异常'});assert.throws(()=>op.adminAction(s,'owner',{type:'settle',matchId:m.id,revision:m.revision,reason:'不允许无比赛凭空结算',legs:[[3,0],[3,0]]}),/已开赛/);assert.equal(s.ledger.length,0);});
