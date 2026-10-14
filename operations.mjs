import {randomUUID} from 'node:crypto';
import {fail,event,settle,ACTIVE,validLegScore,IDLE_MAPS} from './engine.mjs';

export const FAILURE_LABELS={halftime_roster_incomplete:'场内换边时名单不完整',halftime_ack_timeout:'场内换边开赛确认超时',halftime_switch_failed:'场内换边失败',nonstandard_end_or_incomplete_roster:'比赛未达到三胜或结束时名单不完整',nonstandard_end_score:'比赛未达到三胜便结束',end_roster_incomplete:'结束时参赛名单不完整',round_safety_limit:'平局过多，达到回合安全上限',invalid_round_score:'原生回合比分异常',round_limit_update_failed:'回合结束条件设置失败',combat_v2_required:'缺少可信兵种与战斗明细',admin_review:'管理员暂停核查',arrival_timeout:'入服等待超时',roster_disconnected_or_unsynchronized:'比赛中掉线或同步丢失',bridge_process_restarted:'游戏服进程重启',heartbeat_timeout:'游戏服心跳超时',map_preparation_timeout:'换图准备超时',unauthorized_team_change:'比赛中未经允许换队',mission_removed_before_result:'赛果前游戏任务结束',round_roster_invalid:'回合开始时名单不完整'};
const occupied=m=>m.reservation?.serverId||m.server?.id;
function audit(s,actor,type,m,reason,before,now,extra={}){(s.audit??=[]).push({id:randomUUID(),actor,type,matchId:m.id,reason,before,after:m.phase,at:now,...extra});}
function stop(s,m,now){const serverId=occupied(m);if(!serverId||serverId==='simulation')return;
 s.controls??={};const old=s.controls[serverId];if(old?.matchId===m.id)return;
 s.controls[serverId]={id:randomUUID(),serverId,matchId:m.id,type:'stop',status:'pending',at:now};
}
export function pendingControl(s,serverId){return s.controls?.[serverId]?.status==='pending';}
export function adminAction(s,actor,b,now=Date.now()){
 if(b.type==='idle-map'){
  if(s.matches.some(m=>['election','draft'].includes(m.phase)))fail('已有房间正在竞选队长或选人，禁止后台切图');
  const r=s.servers?.[b.serverId],map=IDLE_MAPS.find(m=>m.id===b.map);
  if(!map)fail('请选择可用地图',400);
  if(!r||now-r.lastSeen>20000)fail('服务器离线或心跳过期，请稍后重试');
  if(!r.idleMapSupported)fail('游戏服插件尚不支持后台切图');
  if(r.blocked||r.activeMatchId||s.matches.some(m=>ACTIVE.includes(m.phase)&&occupied(m)===r.id))fail('服务器被排位占用或回传阻塞，不能切图');
  if(pendingControl(s,r.id))fail('已有操作等待游戏服确认');
  if(s.matches.some(m=>m.phase==='awaiting_server'&&!occupied(m)))fail('有排位房间等待服务器，暂不能切图');
  const c={id:randomUUID(),serverId:r.id,type:'idle-map',map:map.id,status:'pending',at:now,expiresAt:now+180000};
  (s.controls??={})[r.id]=c;
  (s.audit??=[]).push({id:randomUUID(),actor,type:b.type,serverId:r.id,matchId:'',reason:'空闲切图：'+map.name,before:'idle',after:'pending',at:now,controlId:c.id});return;
 }
 const m=s.matches.find(m=>m.id===b.matchId);if(!m)fail('房间不存在',404);
 if(m.revision!==b.revision)fail('房间已更新，请重新核对后操作');
 const reason=typeof b.reason==='string'?b.reason.trim():'';if(reason.length<4||reason.length>300)fail('请填写 4–300 字的处理依据',400);
 const before=m.phase;if(!ACTIVE.includes(before))fail('该房间已经结束，不允许重复处理');
 if(b.type==='review'){
  if(!['live','awaiting_server'].includes(before)||!occupied(m))fail('仅已领取或进行中的比赛可暂停核查');
  m.phase='review';m.deadline=null;m.failureReason='admin_review';stop(s,m,now);event(m,'管理员暂停比赛，等待核查：'+reason,now);
 }else if(b.type==='cancel'){
  m.phase='cancelled';m.deadline=null;m.finishedAt=now;m.adminResolution={type:'cancel',reason,actor,at:now};stop(s,m,now);event(m,'管理员取消比赛，不计积分：'+reason,now);
 }else if(b.type==='settle'){
  if(before!=='review'||!m.startedAt)fail('仅已开赛且待核查的比赛可人工结算');
  if(m.ratingRule==='blmm-class-v1'&&(m.format==='two-leg-v1'?m.legs?.length!==2||m.legs.some(l=>l.combat?.version!==2):m.combat?.version!==2))fail('新规则需要完整兵种与战斗明细，不能仅凭比分人工结算；可取消本场');
  if(m.format==='two-leg-v1'){
   if(!Array.isArray(b.legs)||b.legs.length!==2||!b.legs.every(validLegScore))fail('请填写两轮原始 A/B 比分，每轮一方为 3 分',400);
   if(m.legs?.some((l,i)=>JSON.stringify(l.score)!==JSON.stringify(b.legs[i])))fail('人工比分与已回传轮次冲突，不能覆盖原始记录');
   m.legs=b.legs.map((score,i)=>m.legs?.[i]||{score,source:'admin',at:now});
  }
  const score=m.format==='two-leg-v1'?[0,1].map(t=>m.legs.reduce((n,l)=>n+l.score[t],0)):b.score;
  m.phase='live';try{settle(s,m,score,now,'admin');}catch(e){m.phase=before;throw e;}
  if(m.format==='two-leg-v1')m.leg=1;
  m.adminResolution={type:'settle',reason,actor,at:now};stop(s,m,now);event(m,'管理员依据核查结果结算：'+reason,now);
 }else fail('未知管理操作',400);
 audit(s,actor,b.type,m,reason,before,now,{score:m.score,legs:b.legs});
}
export function heartbeat(s,b,now=Date.now()){
 if(typeof b.serverId!=='string'||!b.serverId||b.serverId.length>80)fail('Invalid server ID',400);
 const r=(s.servers??={})[b.serverId]??={id:b.serverId,firstSeen:now};
 r.lastSeen=now;r.activeMatchId=typeof b.matchId==='string'?b.matchId:null;r.blocked=Boolean(b.blocked);r.version=String(b.version||'unknown').slice(0,40);
 r.idleMapSupported=b.idleMapSupported===true;r.currentMap=typeof b.currentMap==='string'?b.currentMap.slice(0,100):null;
 const control=s.controls?.[b.serverId];
 if(b.ackId&&control?.id===b.ackId&&control.status==='pending'){
  if(b.matchId&&!(control.type==='idle-map'&&b.controlResult==='failed'))fail('Cannot release while a mission remains active');
  if(control.type==='idle-map'){
   if(b.controlResult!=='ok'&&b.controlResult!=='failed')fail('Invalid map result',400);
   if(b.controlResult==='ok'&&b.currentMap!==control.map)fail('Loaded map mismatch',400);
   control.status=b.controlResult==='ok'?'acknowledged':'failed';control.error=String(b.controlError||'').slice(0,160);
  }else control.status='acknowledged';control.ackAt=now;
 }
 return {control:control?.status==='pending'?control:null};
}
export function monitor(s,now=Date.now()){
 for(const c of Object.values(s.controls||{}))if(c.type==='idle-map'&&c.status==='pending'&&now>c.expiresAt+30000){c.status='failed';c.error='command_expired';c.ackAt=now;}
 for(const m of s.matches){const id=occupied(m),last=s.servers?.[id]?.lastSeen;
  if(id&&['live','awaiting_server'].includes(m.phase)&&last&&now-last>90000){
   m.phase='review';m.deadline=null;m.failureReason='heartbeat_timeout';event(m,'游戏服超过 90 秒未报心跳，暂停结算并等待核查',now);stop(s,m,now);
  }
 }
}
export function adminView(s,now=Date.now()){
 return {now,maps:IDLE_MAPS,matches:s.matches.slice(0,100).map(m=>({...m,players:m.players.map(id=>({id,name:s.users[id]?.name||id})),failureLabel:FAILURE_LABELS[m.failureReason]||m.failureReason})),
  servers:Object.values(s.servers||{}).map(r=>({...r,online:now-r.lastSeen<=90000,control:s.controls?.[r.id]||null,match:s.matches.find(m=>ACTIVE.includes(m.phase)&&occupied(m)===r.id)?.id||null})),controls:Object.values(s.controls||{}),audit:(s.audit||[]).slice(-100).reverse()};
}
