import {validateCombat,mergeCombat} from './combat.mjs';
import {isPerformanceRule,performanceRating} from './rating.mjs';
import { randomUUID, randomInt } from 'node:crypto';
export const CANDIDATE_MAPS=[{"id":"mp_bnl_ghosttown","name":"幽灵镇","subtitle":"Ghost Town","tone":"stone","image":"/maps/mp_bnl_ghosttown.svg","custom":true,"previewKind":"layout","ranked":true},{"id":"mp_bnl_fortlieve","name":"利耶夫堡","subtitle":"Fort Lieve","tone":"stone","image":"/maps/mp_bnl_fortlieve.svg","custom":true,"previewKind":"layout","ranked":true},{"id":"mp_bnl_purplehaze","name":"紫雾","subtitle":"Purple Haze","tone":"stone","image":"/maps/mp_bnl_purplehaze.svg","custom":true,"previewKind":"layout","ranked":true},{"id":"mp_dao","name":"岛","subtitle":"Dao","tone":"stone","image":"/maps/mp_dao.svg","custom":true,"previewKind":"layout","ranked":true},{"id":"mp_gebi","name":"戈壁","subtitle":"Gebi","tone":"stone","image":"/maps/mp_gebi.svg","custom":true,"previewKind":"layout","ranked":true},{"id":"mp_luzhou","name":"绿洲","subtitle":"Luzhou","tone":"stone","image":"/maps/mp_luzhou.svg","custom":true,"previewKind":"layout","ranked":true}];
export const MAPS=[{"id":"mp_skirmish_map_002f","name":"城镇外围","subtitle":"Town Outskirts","tone":"sand","image":"/maps/mp_skirmish_map_002f.jpg"},{"id":"mp_skirmish_map_003_skinc","name":"贸易站","subtitle":"Trading Post","tone":"forest","image":"/maps/mp_skirmish_map_003_skinc.jpg"},{"id":"mp_skirmish_map_010","name":"埃刻俄里昂","subtitle":"Echerion","tone":"snow","image":"/maps/mp_skirmish_map_010.jpg"},{"id":"mp_skirmish_map_007","name":"骚拿","subtitle":"Xauna","tone":"dusk","image":"/maps/mp_skirmish_map_007.jpg"},{"id":"mp_skirmish_map_008_skin","name":"奥莫尔港","subtitle":"Port at Omor","tone":"stone","image":"/maps/mp_skirmish_map_008_skin.jpg"},{"id":"mp_skirmish_map_009","name":"岑加尔","subtitle":"Zendyar","tone":"stone","image":"/maps/mp_skirmish_map_009.jpg"},{"id":"mp_skirmish_map_014","name":"乌里克斯卡洛尔","subtitle":"Urikskalaar","tone":"stone","image":"/maps/mp_skirmish_map_014.jpg"},{"id":"mp_skirmish_map_020","name":"沙里斯","subtitle":"Sharis","tone":"stone","image":"/maps/mp_skirmish_map_020.jpg"},{"id":"mp_bnl_abandoned_v2","name":"废弃据点","subtitle":"Abandoned V2","tone":"stone","image":"/maps/mp_bnl_abandoned_v2.svg","custom":true,"previewKind":"layout"},{"id":"mp_bnl_fortofhonour","name":"荣誉堡","subtitle":"Fort of Honour","tone":"stone","image":"/maps/mp_bnl_fortofhonour.svg","custom":true,"previewKind":"layout"},{"id":"mp_bnl_lighthouse","name":"灯塔","subtitle":"Lighthouse","tone":"stone","image":"/maps/mp_bnl_lighthouse.svg","custom":true,"previewKind":"layout"}];
MAPS.push(...CANDIDATE_MAPS.filter(m=>m.ranked));
export const IDLE_MAPS=[...MAPS,...CANDIDATE_MAPS.filter(m=>!m.ranked)];
export const CULTURES=[{id:'khuzait',name:'库赛特'},{id:'aserai',name:'阿塞莱'},{id:'battania',name:'巴旦尼亚'},{id:'vlandia',name:'瓦兰迪亚'},{id:'sturgia',name:'斯特吉亚'},{id:'empire',name:'帝国'}];
export const validCultures=c=>Array.isArray(c)&&c.length===2&&c[0]!==c[1]&&c.every(id=>CULTURES.some(x=>x.id===id));
export const DRAFT_ORDER=Object.freeze([0,1,1,0,0,1,1,0,1,0]);
export const validLegScore=score=>Array.isArray(score)&&score.length===2&&score.every(Number.isInteger)&&((score[0]===3&&score[1]>=0&&score[1]<3)||(score[1]===3&&score[0]>=0&&score[0]<3));
export const ACTIVE=['ready','election','draft','veto','awaiting_server','live','review'];
export function fail(message,status=409){throw Object.assign(new Error(message),{status});}
export function rank(r){return r<800?"小丑":r<1200?"农民":r<1400?"卫兵":r<1600?"骑士":r<2000?"骑士长":r<2400?"领主":r<3000?"公爵":r<3600?"亲王":r<4000?"国王":'皇帝';}
export function empty(){return {users:{},queue:[],matches:[],ledger:[],events:[]};}
export function user(s,id,name){return s.users[id]??=( {id,name,rating:1000,wins:0,losses:0,cooldown:0});}
export function active(s,id){return s.matches.find(m=>ACTIVE.includes(m.phase)&&m.players.includes(id));}
export function event(m,text,now){m.timeline.push({at:now,text});m.revision++;}
function phase(m,p,seconds,now){m.phase=p;m.deadline=seconds?now+seconds*1000:null;}
export function pair(s,now=Date.now()){
 let first;
 s.queue.sort((a,b)=>a.at-b.at);
 while(s.queue.length>=12){
  let eligible;
  for(const oldest of s.queue){
   const anchor=s.users[oldest.id].rating,band=200+Math.floor(Math.max(0,now-oldest.at)/60000)*100;
   const group=s.queue.filter(q=>Math.abs(s.users[q.id].rating-anchor)<=band).slice(0,12);
   if(group.length===12){eligible=group;break;}
  }
  if(!eligible)break;
  const ids=eligible.map(q=>q.id);s.queue=s.queue.filter(q=>!ids.includes(q.id));
  s.nextMatchNumber=(s.nextMatchNumber||Math.max(0,...s.matches.map(m=>m.number||0)))+1;
  const m={format:s.matchFormat||'single-v1',ratingRule:s.ratingRule||'elo-team-v1',leg:0,legs:[],id:randomUUID(),number:s.nextMatchNumber,createdAt:now,players:ids,ready:[],captains:[],teams:[[],[]],picks:[],turn:0,revision:0,timeline:[],server:null,score:null};
  phase(m,'ready',45,now);event(m,'12 位玩家已匹配，等待确认',now);s.matches.unshift(m);first??=m;
 }
 return first;
}
export function prepareBattle(m,now=Date.now(),choose=randomInt){
 if(!m.map)m.map=MAPS[choose(MAPS.length)].id;
 const redraw=!validCultures(m.cultures);
 if(redraw){const a=CULTURES.some(c=>c.id===m.cultures?.[0])?m.cultures[0]:CULTURES[choose(CULTURES.length)].id;const opponents=CULTURES.filter(c=>c.id!==a);m.cultures=[a,opponents[choose(opponents.length)].id];}
 if(!m.selection||redraw){m.selection={method:'random-distinct-v2',at:now};event(m,'随机地图与双方不同国家已锁定',now);}
 phase(m,'awaiting_server',0,now);
}
function lockDraftMap(m,now){
 if(!m.map){m.map=MAPS[randomInt(MAPS.length)].id;event(m,'本场地图已锁定：'+MAPS.find(x=>x.id===m.map).name,now);}
}
function beginElection(m,now){
 lockDraftMap(m,now);m.candidates=[];phase(m,'election',30,now);event(m,'队长竞选开始，30 秒内可报名',now);
}
function beginDraft(s,m,now){
 lockDraftMap(m,now);
 const candidates=m.candidates||[],pool=candidates.length>=2?candidates:m.players;
 m.captainSelection=candidates.length>=2?'volunteers':'rating-fallback';
 const sorted=[...pool].sort((a,b)=>s.users[b].rating-s.users[a].rating||a.localeCompare(b));
 m.captains=sorted.slice(0,2);m.teams=m.captains.map(id=>[id]);m.pickOrder=[...DRAFT_ORDER];m.turn=m.pickOrder[0];phase(m,'draft',30,now);event(m,'队长已确定，A 队先选',now);
}
function pick(s,m,id,now){
 if(!m.players.includes(id)||m.teams.flat().includes(id))fail('该玩家已被选择');
 m.teams[m.turn].push(id);m.picks.push({team:m.turn,id});event(m,`${m.turn===0?'A':'B'} 队选择 ${s.users[id].name}`,now);
 m.turn=m.pickOrder?.[m.picks.length]??(1-m.turn);m.deadline=now+30000;
 if(m.picks.length===10)prepareBattle(m,now);
}
export function action(s,actor,b,now=Date.now(),demo=false){
 if(!s.users[actor])fail('请先登录',401);
 if(b.type==='join'){
  if(active(s,actor))fail('你已经在比赛中');
  if(!s.queue.some(q=>q.id===actor))s.queue.push({id:actor,at:now});pair(s,now);return;
 }
 if(b.type==='leave'){s.queue=s.queue.filter(q=>q.id!==actor);return;}
 const m=s.matches.find(x=>x.id===b.matchId);if(!m||!m.players.includes(actor))fail('无法访问这场比赛',403);
 if(b.type==='ready'){
  // Each player's acknowledgement is independent; concurrent confirmations may
  // share a revision. Draft picks still require an exact revision below.
  if(['election','draft'].includes(m.phase)&&m.ready.includes(actor))return;
  if(m.phase==='ready'&&now>=m.deadline)fail('就绪确认已超时');
  if(m.phase!=='ready')fail('当前无需确认');if(!m.ready.includes(actor)){m.ready.push(actor);event(m,`${s.users[actor].name} 已就绪`,now);}if(m.ready.length===12)beginElection(m,now);return;
 }
 if(b.type==='captain-join'||b.type==='captain-withdraw'){
  if(m.phase!=='election')fail('当前不在队长竞选阶段');
  if(now>=m.deadline)fail('队长竞选已结束');
  const joined=m.candidates.includes(actor),joining=b.type==='captain-join';
  if(joined!==joining){m.candidates=joining?[...m.candidates,actor]:m.candidates.filter(id=>id!==actor);event(m,`${s.users[actor].name} ${joining?'报名竞选队长':'取消队长报名'}`,now);}return;
 }
 if(b.revision!==m.revision)fail('房间已更新，请重试');
 if(b.type==='pick'){if(m.phase!=='draft')fail('不在选人阶段');if(!demo&&actor!==m.captains[m.turn])fail('还没轮到你',403);pick(s,m,b.playerId,now);return;}
 if(b.type==='demo-ready'&&demo){if(m.phase!=='ready')fail('阶段已变化');m.ready=[...m.players];beginElection(m,now);return;}
 if(b.type==='demo-election'&&demo){if(m.phase!=='election')fail('阶段已变化');beginDraft(s,m,now);return;}
 if(b.type==='demo-start'&&demo){if(m.phase!=='awaiting_server')fail('请先完成选人');m.server={id:'simulation',name:'模拟训练服务器'};phase(m,'live',0,now);event(m,'模拟比赛开始 · 不连接游戏客户端',now);return;}
 if(b.type==='demo-result'&&demo){finishLeg(s,m,b.score,null,now,'simulation');return;}
 fail('不支持的操作',400);
}
export function settle(s,m,score,now=Date.now(),source='bridge'){
 if(m.phase==='settled')return false;
 if(m.phase!=='live')fail('比赛尚未开始');
 if(m.format==='two-leg-v1'){if(m.legs?.length!==2||!m.legs.every(l=>validLegScore(l.score))||JSON.stringify(score)!==JSON.stringify([0,1].map(t=>m.legs.reduce((n,l)=>n+l.score[t],0))))fail('两轮赛果不完整或合计比分不符',400);}else if(!validLegScore(score))fail('比分必须符合三胜制',400);
 const avg=m.teams.map(t=>t.reduce((n,id)=>n+s.users[id].rating,0)/6),win=score[0]===score[1]?null:score[0]>score[1]?0:1;
 const expected=1/(1+10**((avg[1]-avg[0])/400));const change=Math.round(32*((win===null?0.5:win===0?1:0)-expected));
 if(isPerformanceRule(m.ratingRule)){
  const combat=m.format==='two-leg-v1'?mergeCombat(m.legs,m.players):m.combat;
  if(combat?.version!==2)fail('兵种与战斗明细不完整，不能按新规则结算');
  m.combat=validateCombat(combat,m.players,score);
  m.ratingBreakdown=performanceRating(m.teams,score,m.combat,m.ratingRule);
 }
 m.ratings={};m.changes={};for(let team=0;team<2;team++)for(const id of m.teams[team]){
  const u=s.users[id],delta=m.ratingBreakdown?.[id]?.delta??(team===0?change:-change),before=u.rating;u.rating+=delta;if(win===null)u.draws=(u.draws||0)+1;else u[team===win?'wins':'losses']++;
  m.changes[id]=delta;m.ratings[id]={before,after:u.rating};s.ledger.push({matchId:m.id,userId:id,before,delta,after:u.rating,source,at:now,rule:m.ratingRule||'elo-team-v1',...(m.ratingBreakdown?{breakdown:m.ratingBreakdown[id]}:{})});
 }
 m.score=score;m.winner=win;m.finishedAt=now;phase(m,'settled',0,now);event(m,'赛果已结算，积分流水已保存',now);return true;
}
export function finishLeg(s,m,score,report,now=Date.now(),source='bridge'){
 if(m.phase!=='live')fail('比赛尚未开始');if(!validLegScore(score))fail('每轮比分必须符合三胜制',400);
 const combat=validateCombat(report,m.players,score);
 if(isPerformanceRule(m.ratingRule)&&combat?.version!==2){
  m.pendingResult={leg:m.leg,score:[...score],combat,at:now,source};m.failureReason='combat_v2_required';phase(m,'review',0,now);event(m,'缺少可信兵种与战斗明细，保留比分并暂停积分结算',now);return;
 }
 if(m.format!=='two-leg-v1'){if(combat)m.combat=combat;settle(s,m,score,now,source);return;}
 if((m.legs||[]).length!==m.leg)fail('轮次不匹配');
 m.legs.push({score:[...score],combat,at:now,source});
 if(m.leg===0){m.leg=1;phase(m,'awaiting_server',0,now);event(m,'第一轮比分已保存；原场景交换国家与出生点，回合比分归零、个人战绩保留，准备第二轮，不结算积分',now);return;}
 const total=[0,1].map(t=>m.legs.reduce((n,l)=>n+l.score[t],0));
 settle(s,m,total,now,source);
 m.combat=mergeCombat(m.legs,m.players);
}
export function tick(s,now=Date.now()){
 let changed=false;
 for(const m of s.matches){if(m.phase==='veto'||(m.phase==='awaiting_server'&&!validCultures(m.cultures))){
  if(m.reservation){m.failureReason='culture_rule_changed';phase(m,'review',0,now);event(m,'已领取比赛的国家规则不符，暂停等待核查',now);}else prepareBattle(m,now);
  changed=true;
 }if(m.phase==='draft'&&!m.map){lockDraftMap(m,now);changed=true;}if(!m.deadline||now<m.deadline)continue;changed=true;
  if(m.phase==='ready'){
   for(const id of m.players){s.users[id].cooldown=0;if(m.ready.includes(id)&&!s.queue.some(q=>q.id===id))s.queue.push({id,at:m.createdAt});}
   phase(m,'cancelled',0,now);event(m,'就绪超时，已确认玩家保留排队优先级',now);
  } else if(m.phase==='election'){
   beginDraft(s,m,now);
  } else if(m.phase==='draft'){
   const available=m.players.filter(id=>!m.teams.flat().includes(id));const target=m.turn;
   const sum=t=>t.reduce((n,id)=>n+s.users[id].rating,0);
   available.sort((a,b)=>Math.abs((sum(m.teams[target])+s.users[a].rating)/(m.teams[target].length+1)-sum(m.teams[1-target])/m.teams[1-target].length)-Math.abs((sum(m.teams[target])+s.users[b].rating)/(m.teams[target].length+1)-sum(m.teams[1-target])/m.teams[1-target].length));
   event(m,'选人超时，系统代选',now);pick(s,m,available[0],now);
  }
 }
 s.queue.sort((a,b)=>a.at-b.at);if(pair(s,now))changed=true;return changed;
}
export function fillDemo(s,actor,now=Date.now()){
 if(active(s,actor))fail('已有进行中的房间');action(s,actor,{type:'join'},now,true);
 const names=['北境骑士','青石','长弓与酒','沙丘旅人','苍鹰','晚风','渡鸦','铁卫','山海','赤焰','白鹿'];
 names.forEach((name,i)=>{const id=`bot-${i}`,u=user(s,id,name);if(!u.wins&&!u.losses)u.rating=860+i*27;u.bot=true;if(!active(s,id)&&!s.queue.some(q=>q.id===id))s.queue.push({id,at:now+i});});pair(s,now);
}
export function bridge(s,b,now=Date.now()){
 if(typeof b.eventId!=='string'||b.eventId.length<8||b.eventId.length>100)fail('Invalid event ID',400);
 const prior=s.events.find(e=>e.id===b.eventId);if(prior){if(prior.payload!==JSON.stringify(b))fail('Event ID conflict');return;}
 const m=s.matches.find(x=>x.id===b.matchId);if(!m)fail('Unknown match',404);
 if(m.reservation && m.reservation.serverId!==b.serverId)fail('Match reserved by another server',403);
 if(m.format==='two-leg-v1'&&b.leg!==m.leg)fail('Match leg mismatch');
 if(m.adminResolution||m.cancelReason==='arrival_timeout'||m.failureReason==='admin_review'||m.failureReason==='heartbeat_timeout'){if(['started','finished','failed'].includes(b.type)&&m.reservation?.serverId===b.serverId){s.events.push({id:b.eventId,payload:JSON.stringify(b),at:now,ignored:true});return;}fail('Match closed by administrator');}
 if(b.type==='started'){
  if(m.phase!=='awaiting_server')fail('Match is not awaiting server');
  if(!m.reservation)fail('Claim the match before starting');
  if(!validCultures(b.cultures)||b.map!==m.map||JSON.stringify(b.teams)!==JSON.stringify(m.teams)||JSON.stringify(b.cultures)!==JSON.stringify(m.cultures))fail('Roster, map or cultures mismatch');
  if(typeof b.serverId!=='string'||!b.serverId||b.serverId.length>80)fail('Invalid server ID',400);
  if(s.matches.some(x=>x.phase==='live'&&x.server?.id===b.serverId))fail('Server already occupied');
  m.server={id:b.serverId,name:b.serverId};m.startedAt??=now;phase(m,'live',0,now);event(m,'受信任服务器确认名单、地图并开始比赛',now);
 }else if(b.type==='finished'){
  if(m.server?.id!==b.serverId)fail('Server mismatch',403);if(m.phase==='settled')fail('Already settled');finishLeg(s,m,b.score,b.combat,now);
 }else if(b.type==='failed'){
  if(!((m.server?.id===b.serverId&&m.phase==='live')||(m.reservation?.serverId===b.serverId&&m.phase==='awaiting_server')))fail('Server mismatch');
  m.failureReason=String(b.reason||'unknown').slice(0,300);
  if(b.reason==='arrival_timeout'&&m.phase==='awaiting_server'&&!m.startedAt&&!(m.legs?.length)){
   m.cancelReason='arrival_timeout';m.finishedAt=now;phase(m,'cancelled',0,now);
   s.controls??={};s.controls[b.serverId]={id:randomUUID(),serverId:b.serverId,matchId:m.id,type:'stop',status:'pending',at:now};
   event(m,'入服热身等待 5 分钟，参赛名单未齐，比赛自动取消，不计积分',now);
  }else{phase(m,'review',0,now);event(m,'服务器异常，暂停自动结算，等待核查',now);}
 }else fail('Unknown event type',400);
 s.events.push({id:b.eventId,payload:JSON.stringify(b),at:now});
}
export function claim(s,b,now=Date.now()){
 if(typeof b.serverId!=='string'||!b.serverId||b.serverId.length>80)fail('Invalid server ID',400);
 if(s.controls?.[b.serverId]?.status==='pending')fail('Server is awaiting stop acknowledgement');
 const m=s.matches.find(x=>x.id===b.matchId);if(!m||m.phase!=='awaiting_server')fail('Match is not awaiting server');
 if(!validCultures(m.cultures))fail('Two distinct valid cultures required');
 if(b.map!==m.map)fail('Map mismatch');
 if(m.reservation?.serverId===b.serverId)return job(m);
 if(m.reservation)fail('Match already reserved');
 if(s.matches.some(x=>['awaiting_server','live','review'].includes(x.phase)&&(x.reservation?.serverId===b.serverId||x.server?.id===b.serverId)))fail('Server already occupied');
 m.reservation={serverId:b.serverId,at:now};event(m,'游戏服务器已领取比赛，等待玩家进入',now);return job(m);
}
export function job(m){return {format:m.format||'single-v1',leg:m.leg||0,matchId:m.id,map:m.map,cultures:m.cultures,teams:m.teams,revision:m.revision,mode:'Skirmish',roundsToWin:3,reservedBy:m.reservation?.serverId||null};}

export function fillDemo24(s,actor,now=Date.now()){
 if(active(s,actor))fail('已有进行中的房间');
 const batch=randomUUID().slice(0,6),ids=[actor];
 for(let i=0;i<23;i++){const id='demo-'+batch+'-'+i,u=user(s,id,'演练骑士 '+(i+1));u.rating=s.users[actor].rating+(i%7-3)*18;u.bot=true;ids.push(id);}
 for(const id of ids)if(!s.queue.some(q=>q.id===id))s.queue.push({id,at:now});
 pair(s,now);
 for(const m of s.matches.filter(m=>m.phase==='ready'&&m.players.some(id=>id.startsWith('demo-'+batch+'-')))){
   m.ready=m.players.filter(id=>s.users[id].bot);if(m.ready.length===12){beginDraft(s,m,now);while(m.phase==='draft')pick(s,m,m.players.find(id=>!m.teams.flat().includes(id)),now);}
 }
}
