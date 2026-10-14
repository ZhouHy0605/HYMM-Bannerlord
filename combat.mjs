// Aggregate only complete, trusted match reports. Missing legacy reports are not zeroes.
export function validateCombat(report, players, score) {
 if(report==null)return null;
 const bad=()=>{throw Object.assign(new Error('Invalid combat statistics'),{status:400});};
 if(![1,2].includes(report.version)||!Array.isArray(report.players)||report.players.length!==12)bad();
 const drawRounds=report.version===2?(report.drawRounds??0):0;
 if(!Number.isSafeInteger(drawRounds)||drawRounds<0||drawRounds>198||report.version===1&&(report.drawRounds??0)!==0)bad();
 const ids=new Set();
 for(const p of report.players){
  if(!p||!players.includes(p.id)||ids.has(p.id))bad();ids.add(p.id);
  for(const k of ['kills','deaths','assists','damage','rounds'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1000000)bad();
  if(p.nativeScore!==undefined&&(!Number.isSafeInteger(p.nativeScore)||Math.abs(p.nativeScore)>1000000))bad();
  if(p.rounds!==score[0]+score[1]+drawRounds)bad();
  if(report.version===2){
   for(const k of ['horseDamage','spawns'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1000000)bad();
   if(p.deaths>p.spawns||!p.classes)bad();
   // A roster member may be offline for an entire half. Zero activity is
   // explicit evidence, not a fabricated infantry spawn or missing report.
   if(p.spawns===0&&['kills','deaths','assists','damage','horseDamage'].some(k=>p[k]!==0))bad();
   for(const k of ['infantry','archer','cavalry'])if(!Number.isSafeInteger(p.classes[k])||p.classes[k]<0||p.classes[k]>p.spawns)bad();
   if(p.classes.infantry+p.classes.archer+p.classes.cavalry!==p.spawns)bad();
  }
 }
 return {version:report.version,...(drawRounds?{drawRounds}:{}),players:report.players.map(({id,kills,deaths,assists,damage,rounds,horseDamage,spawns,classes,nativeScore})=>({id,kills,deaths,assists,damage,rounds,...(nativeScore!==undefined?{nativeScore}:{}),...(report.version===2?{horseDamage,spawns,classes:{infantry:classes.infantry,archer:classes.archer,cavalry:classes.cavalry}}:{})}))};
}
export function mergeCombat(legs,players){
 if(!legs.length||!legs.every(l=>l.combat))return null;
 const version=legs.every(l=>l.combat.version===2)?2:1;
 const drawRounds=legs.reduce((n,l)=>n+(l.combat.drawRounds||0),0);
 if(version===1&&drawRounds)return null; // Legacy format cannot represent drawn rounds.
 return {version,...(drawRounds?{drawRounds}:{}),players:players.map(id=>{
  const p={id};const parts=legs.map(l=>l.combat.players.find(p=>p.id===id));
  for(const k of ['kills','deaths','assists','damage','rounds',...(version===2?['horseDamage','spawns']:[])])p[k]=parts.reduce((n,x)=>n+x[k],0);
  if(version===2)p.classes=Object.fromEntries(['infantry','archer','cavalry'].map(k=>[k,parts.reduce((n,x)=>n+x.classes[k],0)]));
  if(parts.every(x=>Number.isSafeInteger(x.nativeScore)))p.nativeScore=parts.reduce((n,x)=>n+x.nativeScore,0);
  return p;
 })};
}
export function combatStats(world,id){
 const total={matches:0,rounds:0,kills:0,deaths:0,assists:0,damage:0,horseDamage:0,score:0,scoreEstimatedMatches:0};
 for(const m of world.matches){
  if(m.phase!=='settled')continue;
  const p=m.combat?.players.find(p=>p.id===id);if(!p)continue;
  total.matches++;for(const key of ['rounds','kills','deaths','assists','damage'])total[key]+=p[key];
  total.horseDamage+=p.horseDamage??0;
  if(Number.isSafeInteger(p.nativeScore))total.score+=p.nativeScore;
  else {
   // Legacy reports lack native per-hit truncation and score deductions.
   // Keep their history, but explicitly label this fallback as an estimate.
   total.score+=p.damage+0.35*(p.horseDamage??0);total.scoreEstimatedMatches++;
  }
 }
 return {...total,adr:total.rounds?total.score/total.rounds:null,kd:total.matches?total.kills/Math.max(1,total.deaths):null,kda:total.matches?(total.kills+total.assists)/Math.max(1,total.deaths):null};
}
