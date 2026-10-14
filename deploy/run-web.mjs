// Run one copy under Task Scheduler. Never writes environment values to logs.
import {spawn} from 'node:child_process';
import {mkdirSync,createWriteStream,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logs=path.join(root,'deploy','logs');mkdirSync(logs,{recursive:true});
let child,stopping=false,stream,logPath,restarts=0,bytes=0;
function output(data){
 const stamp=new Date().toISOString().slice(0,10),next=path.join(logs,`web-${stamp}-${restarts}.log`);
 if(next!==logPath||bytes>10*1024*1024){stream?.end();if(next===logPath)restarts++;logPath=path.join(logs,`web-${stamp}-${restarts}.log`);stream=createWriteStream(logPath,{flags:'a'});try{bytes=statSync(logPath).size;}catch{bytes=0;}}
 bytes+=Buffer.byteLength(data);stream.write(data);
}
function start(){
 output(`\n[${new Date().toISOString()}] HYMM starting\n`);
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',output);child.stderr.on('data',output);
 child.on('error',e=>output(`Launch error: ${e.code}\n`));
 child.on('close',code=>{output(`[${new Date().toISOString()}] Exit ${code}\n`);if(!stopping){restarts++;setTimeout(start,5000);}else{stream?.end();}});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;if(child?.exitCode===null)child.kill();else stream?.end();});
start();
