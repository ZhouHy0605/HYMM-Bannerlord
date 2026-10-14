// Loaded only by the isolated HTTP test process. Production never imports it.
import {MockAgent,setGlobalDispatcher} from 'undici';
const agent=new MockAgent();agent.disableNetConnect();setGlobalDispatcher(agent);
agent.get('https://steamcommunity.com').intercept({path:'/openid/login',method:'POST'}).reply(options=>{
 const q=new URLSearchParams(String(options.body));
 return {statusCode:200,data:'ns:http://specs.openid.net/auth/2.0\nis_valid:'+(q.get('openid.sig')==='test-valid'?'true':'false')+'\n'};
}).persist();
agent.get('https://api.steampowered.com').intercept({path:/^\/ISteamUser\/GetPlayerSummaries\//,method:'GET'}).reply(200,{response:{players:[{steamid:'76561198000000001',personaname:'测试骑士',avatarfull:'https://avatars.steamstatic.com/test.jpg'}]}}).persist();
