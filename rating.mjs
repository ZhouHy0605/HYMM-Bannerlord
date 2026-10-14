// Inspired by EastSeaC/blmmbot ScoreMaster.py (de2d00a). HYMM fixes team
// denominators and zero divisions; removes the abrupt 500/3000 team-score switch.
export const PERFORMANCE_RULE='blmm-class-v1';
const clamp=(n,max)=>Math.max(0,Math.min(n,max));
export function performanceRating(teams,score,report){
 if(report?.version!==2)throw new Error('兵种与战斗明细不完整，不能按新规则结算');
 const records=new Map(report.players.map(p=>[p.id,p]));
 const result={};
 for(let team=0;team<2;team++){
  const enemies=teams[1-team].reduce((n,id)=>n+records.get(id).spawns,0);
  const assists=teams[team].reduce((n,id)=>n+records.get(id).assists,0);
  for(const id of teams[team]){
   const p=records.get(id);
   const kills=enemies?clamp(15*p.kills/enemies,15):0;
   const survival=p.spawns?clamp(12*(p.spawns-p.deaths+1)/p.spawns,12):0;
   const assist=assists?clamp(7*p.assists/assists,7):0;
   const damage=clamp(40*p.damage/(1266*p.rounds),40);
   const horseDamage=clamp(40*p.horseDamage/(3*1266*p.rounds),40);
   const personal=Math.ceil(kills+survival+assist+damage+horseDamage);
   const teamScore=(score[team]-score[1-team])*20;
   const base=teamScore+personal,cavalryShare=p.spawns?p.classes.cavalry/p.spawns:0;
   const factor=1+0.5*cavalryShare;
   const adjusted=base>=0?base/factor:base*factor;
   // Symmetric nearest-integer rounding; -10.5 must not favor the loser.
   const delta=adjusted<0?-Math.round(-adjusted):Math.round(adjusted);
   result[id]={rule:PERFORMANCE_RULE,teamScore,kills,survival,assists:assist,damage,horseDamage,personal,base,
    spawns:p.spawns,classes:{...p.classes},cavalryShare,factor,adjustment:delta-base,delta};
  }
 }
 return result;
}
