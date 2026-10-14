import {ProxyAgent} from 'undici';

// Only Steam's server-side requests use this transport; local APIs stay direct.
export function createSteamRequest(proxy=''){
 let dispatcher;
 if(proxy){
  const u=new URL(proxy);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('STEAM_HTTP_PROXY must be an HTTP(S) proxy URL without credentials or a path');
  dispatcher=new ProxyAgent(u.href);
 }
 return (url,options={})=>{
  const u=new URL(url);
  if(u.protocol!=='https:'||!['steamcommunity.com','api.steampowered.com'].includes(u.hostname)||u.username||u.password||u.port)throw new Error('Invalid Steam request destination');
  return fetch(u,{...options,redirect:'error',...(dispatcher?{dispatcher}:{})});
 };
}
