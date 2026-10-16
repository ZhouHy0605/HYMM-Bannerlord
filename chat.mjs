import {createHash} from 'node:crypto';
import {fail} from './engine.mjs';

export function chatStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS chat_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, name TEXT NOT NULL,
  avatar TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, nonce TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(author,nonce));
  CREATE INDEX IF NOT EXISTS chat_author_time ON chat_messages(author,created);`);
 let cache=null;
 const recent=db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100');
 const find=db.prepare('SELECT * FROM chat_messages WHERE author=? AND nonce=?');
 function view(){
  if(!cache){
   const messages=recent.all().reverse().map(m=>m.deleted?{id:m.id,createdAt:m.created,deleted:true}:{id:m.id,authorId:m.author,name:m.name,avatar:m.avatar,text:m.text,createdAt:m.created});
   const data={messages};cache={data,etag:'"chat-'+createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,24)+'"'};
  }
  return cache;
 }
 return {
  view,
  send(author,profile,input,now=Date.now()){
   if(!/^\d{17}$/.test(author)||!profile)fail('请先使用 Steam 登录',401);
   if(!input||typeof input.text!=='string'||typeof input.nonce!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(input.nonce))fail('消息格式无效，请刷新后重试',400);
   const text=input.text.replace(/\r\n?/g,'\n').trim();
   if(!text||text.length>500||text.split('\n').length>12||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))fail('请输入 1–500 字，最多 12 行',400);
   const old=find.get(author,input.nonce);
   if(old){if(!old.deleted&&old.text!==text)fail('消息编号已使用，请重新发送',409);return {id:old.id};}
   const frequency=db.prepare('SELECT MAX(created) AS last,COUNT(*) AS count FROM chat_messages WHERE author=? AND created>?').get(author,now-60000);
   if(frequency.count>=10||frequency.last!=null&&now-frequency.last<2000)fail('发言太快了，请稍后再试（每 2 秒一条，每分钟最多 10 条）',429);
   const name=String(profile.name||'HYMM 玩家').slice(0,80);
   let avatar='';try{const u=new URL(profile.avatar);if(u.protocol==='https:'&&['avatars.steamstatic.com','avatars.akamai.steamstatic.com','avatars.cloudflare.steamstatic.com'].includes(u.hostname))avatar=u.href;}catch{}
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=db.prepare('INSERT INTO chat_messages(author,name,avatar,text,created,nonce) VALUES(?,?,?,?,?,?)').run(author,name,avatar,text,now,input.nonce);
    db.prepare('DELETE FROM chat_messages WHERE id < (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1 OFFSET 499)').run();
    db.exec('COMMIT');cache=null;return {id:Number(result.lastInsertRowid)};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  remove(actor,id,admin=false){
   if(!Number.isSafeInteger(id)||id<=0)fail('消息编号无效',400);
   const row=db.prepare('SELECT author,deleted FROM chat_messages WHERE id=?').get(id);
   if(!row)fail('消息已不存在',404);
   if(row.author!==actor&&!admin)fail('只能撤回自己的消息',403);
   if(!row.deleted){db.prepare("UPDATE chat_messages SET text='',name='',avatar='',deleted=1 WHERE id=?").run(id);cache=null;}
   return {ok:true};
  }
 };
}
