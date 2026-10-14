export function safeAvatar(value){
 try{const u=new URL(value);return u.protocol==='https:'&&['avatars.steamstatic.com','avatars.akamai.steamstatic.com','avatars.cloudflare.steamstatic.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}
}
export async function steamProfile(id,key,request=fetch){
 if(!key)return null;
 try{
  const url=new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');url.searchParams.set('key',key);url.searchParams.set('steamids',id);
  const response=await request(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)return null;
  const p=(await response.json()).response?.players?.find(p=>p.steamid===id);if(!p||typeof p.personaname!=='string')return null;
  return {name:p.personaname.slice(0,40),avatar:safeAvatar(p.avatarfull)||safeAvatar(p.avatarmedium)||safeAvatar(p.avatar),steamSyncedAt:Date.now()};
 }catch{return null;}
}
