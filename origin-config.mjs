export function originConfig(env){
 const origin=new URL(env.PUBLIC_ORIGIN||`http://127.0.0.1:${env.PORT||3210}`).origin;
 const url=new URL(origin),secure=url.protocol==='https:',local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(!['http:','https:'].includes(url.protocol))throw new Error('PUBLIC_ORIGIN must use HTTP or HTTPS');
 const httpTest=env.ALLOW_INSECURE_HTTP_TEST==='1';
 if(!secure&&!local&&!httpTest)throw new Error('Public deployment requires HTTPS PUBLIC_ORIGIN (HTTP testing requires explicit ALLOW_INSECURE_HTTP_TEST=1)');
 let publicTestPort=null;
 if(env.PUBLIC_HTTP_TEST_PORT){
  publicTestPort=Number(env.PUBLIC_HTTP_TEST_PORT);
  if(!httpTest||secure||!Number.isInteger(publicTestPort)||publicTestPort<1024||publicTestPort>65535||publicTestPort===Number(env.PORT||3210)||Number(url.port||80)!==publicTestPort)
   throw new Error('PUBLIC_HTTP_TEST_PORT requires explicit HTTP testing, a matching public origin port, and a separate high port');
 }
 return {origin,secure,publicTestPort};
}
