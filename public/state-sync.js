export function pollDelay(state,hidden=false){
 const participating=state?.current||state?.me&&state.queue?.some(q=>q.user.id===state.me.id);
 return participating?2500:hidden?30000:10000;
}
export function statePath(state,tab,selectedMatch){
 return !state||['history','profile','rank','ranks'].includes(tab)||selectedMatch?'/api/state':'/api/state?view=live';
}
export function sameIdentity(a,b){return a?.mode===b?.mode&&a?.me?.id===b?.me?.id&&a?.isAdmin===b?.isAdmin&&a?.csrf===b?.csrf;}
export function mergeState(previous,next){
 if(!next.partial)return next;
 if(!previous||!sameIdentity(previous,next))throw Error('Full state required after identity change');
 const updated=new Map(next.matches.map(m=>[m.id,m]));
 const matches=[...next.matches,...previous.matches.filter(m=>!updated.has(m.id))].slice(0,30);
 const result={...previous,...next,users:{...previous.users,...next.users},matches};delete result.partial;return result;
}
