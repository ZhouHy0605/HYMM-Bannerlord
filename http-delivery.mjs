import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzip,gzipSync} from 'node:zlib';
import path from 'node:path';

export function acceptsGzip(req){
 const values=String(req.headers['accept-encoding']||'').toLowerCase().split(',').map(x=>x.trim().split(';'));
 const match=values.find(([name])=>name==='gzip')||values.find(([name])=>name==='*');
 return !!match&&!match.slice(1).some(p=>/^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));
}
export function sendJSON(res,status,data){
 const bytes=Buffer.from(JSON.stringify(data));
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding'};
 const finish=(body,compressed=false)=>{if(res.destroyed)return;res.writeHead(status,{...headers,...(compressed?{'Content-Encoding':'gzip'}:{}),'Content-Length':body.length});res.end(body);};
 if(bytes.length>=1024&&acceptsGzip(res.req))gzip(bytes,{level:1},(error,compressed)=>finish(error?bytes:compressed,!error));
 else finish(bytes);
}

// Assets are read/hashed once per process. Rewritten dependency hashes propagate
// into their parents, so changing a module or font invalidates the whole URL chain.
export function assetDelivery(root,assets,immutable,types){
 const cache=new Map();
 async function build(p){
  if(cache.has(p))return cache.get(p);
  const promise=(async()=>{
   const file=assets[p],ext=path.extname(file).slice(1);let bytes=await readFile(path.join(root,file));
   if(['html','css','js'].includes(ext)){
    let text=bytes.toString('utf8');
    const pattern=ext==='html'?/(?:src|href)=["']([^"']+)["']/g:ext==='css'?/url\(\s*["']?([^\s"')]+)["']?\s*\)/g:/\b(?:from\s*|import\s*)["']([^"']+)["']/g;
    const replacements=[];
    for(const match of text.matchAll(pattern)){
     if(/^(?:[a-z]+:|\/\/|#)/i.test(match[1]))continue;
     const dependency=new URL(match[1],'http://assets.local'+p).pathname;
     if(!assets[dependency]||dependency===p)continue;
     const asset=await build(dependency);
     replacements.push([match.index,match[0],match[0].replace(match[1],dependency+'?v='+asset.version)]);
    }
    for(const [index,before,after] of replacements.reverse())text=text.slice(0,index)+after+text.slice(index+before.length);
    bytes=Buffer.from(text);
   }
   const version=createHash('sha256').update(bytes).digest('hex').slice(0,20);
   const compressed=['html','css','js','json','svg','txt'].includes(ext)&&bytes.length>=1024?gzipSync(bytes,{level:6}):null;
   return {bytes,compressed,version,type:types[ext]||'application/octet-stream'};
  })();cache.set(p,promise);
  try{return await promise;}catch(e){cache.delete(p);throw e;}
 }
 return async(req,res,url)=>{
  const p=url.pathname,asset=await build(p),compressed=acceptsGzip(req)?asset.compressed:null,body=compressed||asset.bytes;
  const etag='"'+asset.version+(compressed?'-gzip':'')+'"';
  const headers={'Content-Type':asset.type,'Cache-Control':p!=='/'&&(immutable.has(p)||url.searchParams.get('v')===asset.version)?'public, max-age=31536000, immutable':'no-cache','Vary':'Accept-Encoding','ETag':etag,...(compressed?{'Content-Encoding':'gzip'}:{})};
  const tags=String(req.headers['if-none-match']||'').split(',').map(t=>t.trim().replace(/^W\//,''));
  if(tags.includes(etag)||tags.includes('*')){res.writeHead(304,headers);res.end();return;}
  res.writeHead(200,{...headers,'Content-Length':body.length});res.end(body);
 };
}
