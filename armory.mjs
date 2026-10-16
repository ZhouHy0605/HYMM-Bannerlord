import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fail} from './engine.mjs';

export const armoryCatalog=JSON.parse(readFileSync(new URL('./public/armory-catalog.json',import.meta.url),'utf8'));
const classes=new Map(armoryCatalog.classes.map(c=>[c.id,c]));
const items=new Map(armoryCatalog.items.map(c=>[c.id,c]));
export function validateArmory(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('配装格式不正确',400);
 const c=classes.get(input.classId);if(!c)fail('无效兵种',400);
 if(input.items===null)return {classId:c.id,items:null};
 if(!Array.isArray(input.items)||input.items.length>5||input.items.some(id=>typeof id!=='string'))fail('每个部位只能选择一件外观',400);
 const slots=new Set(),targets=new Set();
 for(const id of input.items){
  const item=items.get(id);if(!item||!c.items.includes(id))fail('该外观不适用于此兵种',400);
  if(slots.has(item.slot))fail('同一部位不能重复选择',400);slots.add(item.slot);
  // Native conversion uses Dictionary.Add for every replacement, even unused ones.
  for(const target of [...item.replaces,...item.itemless.filter(x=>x.classId===c.id).map(x=>x.slot)]){
   if(targets.has(target))fail('这些外观不能同时使用',400);targets.add(target);
  }
 }
 return {classId:c.id,items:[...input.items].sort()};
}
export function armoryStore(db){
 db.exec('CREATE TABLE IF NOT EXISTS armory_profiles(user_id TEXT NOT NULL, class_id TEXT NOT NULL, items TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,class_id))');
 const read=db.prepare('SELECT class_id,items FROM armory_profiles WHERE user_id=? ORDER BY class_id');
 function checkedIds(ids){if(!Array.isArray(ids)||ids.length>64||ids.some(id=>typeof id!=='string'||!/^\d{17}$/.test(id)))fail('无效玩家列表',400);return [...new Set(ids)];}
 return {
  get(userId){return Object.fromEntries(read.all(userId).map(r=>[r.class_id,JSON.parse(r.items)]));},
  save(userId,input){const value=validateArmory(input);if(value.items===null)db.prepare('DELETE FROM armory_profiles WHERE user_id=? AND class_id=?').run(userId,value.classId);else db.prepare('INSERT INTO armory_profiles VALUES(?,?,?,?) ON CONFLICT(user_id,class_id) DO UPDATE SET items=excluded.items,updated_at=excluded.updated_at').run(userId,value.classId,JSON.stringify(value.items),Date.now());return this.get(userId);},
  batch(ids){return Object.fromEntries(checkedIds(ids).map(id=>[id,this.get(id)]));},
  delta(ids,known){
   ids=checkedIds(ids);
   if(!known||typeof known!=='object'||Array.isArray(known)||Object.keys(known).length>64||Object.entries(known).some(([id,v])=>!/^\d{17}$/.test(id)||typeof v!=='string'||v.length>128))fail('无效配装版本',400);
   const profiles={},versions={};
   for(const id of ids){
    const rows=read.all(id),version=createHash('sha256').update(JSON.stringify(rows)).digest('hex');versions[id]=version;
    if(known[id]!==version)profiles[id]=Object.fromEntries(rows.map(r=>[r.class_id,JSON.parse(r.items)]));
   }
   return {profiles,versions};
  }
 };
}
