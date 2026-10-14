import {isIP} from 'node:net';
// Trust only the local reverse proxy, and only when explicitly enabled.
export function clientIP(req,trustLocal=false){
 const peer=req.socket.remoteAddress;
 if(trustLocal&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
  if(isIP(forwarded))return forwarded;
 }
 return peer;
}
