const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const outlines={Head:'M8 18V9a4 4 0 0 1 8 0v9M5 18h14M9 11h6M12 5V2',Body:'m8 3 4 3 4-3 6 5-4 5-2-2v10H8V11l-2 2-4-5Z',Cape:'m8 3 4 3 4-3 6 18H2ZM12 6v15',Gloves:'M7 12V5h2v6-8h3v8-7h3v8-5h3v11l-4 4H8l-5-8 2-2Z',Leg:'M7 2h10l-1 13 5 4v3h-9V12h-1v10H2v-3l5-4Z'};
const icon=slot=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" aria-hidden="true"><path d="${outlines[slot]||outlines.Body}"/></svg>`;
export function createArmory({getState,request,render,toast}){
 let catalog=null,profile={},drafts={},owner=null,loading=false,error='',culture='empire',classId=null,slot='Body',saving=false,epoch=0;
 function identity(){const s=getState();return s?.mode==='ranked'?s.me?.id:null;}
 function current(){return catalog?.classes.find(c=>c.id===classId)||catalog?.classes.find(c=>c.culture===culture);}
 function selected(c){return drafts[c.id]??profile[c.id]??[];}
 function dirty(c){return Object.hasOwn(drafts,c.id)&&JSON.stringify([...drafts[c.id]].sort())!==JSON.stringify([...(profile[c.id]||[])].sort())||Object.hasOwn(drafts,c.id)&&!Object.hasOwn(profile,c.id);}
 async function load(){
  if(loading)return;loading=true;error='';const generation=epoch,id=owner;
  try{const [data,saved]=await Promise.all([catalog?Promise.resolve(catalog):request('/armory-catalog.json'),id?request('/api/armory'):Promise.resolve({classes:{}})]);if(generation!==epoch)return;catalog=data;profile=saved.classes;}
  catch(e){if(generation===epoch)error=e.message;}
  finally{if(generation===epoch){loading=false;render();}}
 }
 return {
  view(){
   if(owner!==identity()){owner=identity();profile={};drafts={};epoch++;loading=false;error='';load();}
   if(!catalog&&!loading&&!error)load();
   const heading='<section class="armory-heading"><small>HYMM / ARMORY</small><h1>军械库</h1><p>六国兵种，自由配装。外观免费使用，仅在 HYMM 生效。</p><span class="badge amber">外观测试版</span></section>';
   if(error)return heading+`<section class="panel"><p role="alert">${esc(error)}</p><button class="secondary" data-armory="reload">重新加载</button></section>`;
   if(!catalog||loading)return heading+'<section class="panel" role="status">正在读取军械库…</section>';
   const c=current();classId=c.id;const selection=selected(c),byId=new Map(catalog.items.map(i=>[i.id,i]));
   const equipped=selection.map(id=>byId.get(id)).filter(Boolean),options=c.items.map(id=>byId.get(id)).filter(i=>i.slot===slot),isDirty=dirty(c),hasPreset=Object.hasOwn(profile,c.id)||Object.hasOwn(drafts,c.id);
   return heading+`<div class="armory-cultures" aria-label="国家">${catalog.cultures.map(x=>`<button data-armory="culture" data-id="${x.id}" class="${x.id===culture?'active':''}" aria-pressed="${x.id===culture}">${esc(x.name)}<small>7 个兵种</small></button>`).join('')}</div><div class="armory-layout"><aside class="armory-classes"><small>选择兵种</small>${catalog.classes.filter(x=>x.culture===culture).map(x=>`<button data-armory="class" data-id="${x.id}" class="${x.id===c.id?'active':''}" aria-pressed="${x.id===c.id}"><span>${esc(x.name)}</span><small>${Object.hasOwn(drafts,x.id)?'待保存':Object.hasOwn(profile,x.id)?'已配装':'游戏内配装'}</small></button>`).join('')}<p>${catalog.classes.length} 个兵种<br>${catalog.items.length} 件适配衣装</p></aside><section class="armory-main"><div class="armory-loadout-heading"><div><small>${esc(catalog.cultures.find(x=>x.id===culture).name)}</small><h2>${esc(c.name)}</h2></div><span class="badge">${isDirty?'尚未保存':hasPreset?'已保存网页配装':'使用游戏内配装'}</span></div><div class="armory-slots">${catalog.slots.map(s=>{const item=equipped.find(i=>i.slot===s.id);return `<button data-armory="slot" data-id="${s.id}" class="${slot===s.id?'active':''}" aria-pressed="${slot===s.id}">${icon(s.id)}<small>${s.name}</small><strong>${esc(item?.name||(hasPreset?'默认装备':'游戏内选择'))}</strong></button>`;}).join('')}</div><div class="armory-options-heading"><h3>${catalog.slots.find(x=>x.id===slot).name}外观 <small>${options.length} 件</small></h3><span>部位示意图 · 实际外观请进服查看</span></div><div class="armory-options"><button class="armory-item ${!equipped.some(i=>i.slot===slot)?'selected':''}" data-armory="item" data-id="" aria-pressed="${!equipped.some(i=>i.slot===slot)}">${icon(slot)}<strong>默认装备</strong><small>${esc(c.defaults[slot]||'跟随兵种与技能')}</small></button>${options.map(i=>`<button class="armory-item ${selection.includes(i.id)?'selected':''}" data-armory="item" data-id="${i.id}" aria-pressed="${selection.includes(i.id)}">${icon(slot)}<strong>${esc(i.name)}</strong><small>${selection.includes(i.id)?'已选择':'免费选择'}</small>${c.requirements?.[i.id]?.length?`<small class="armory-requirement">需选技能：${esc(c.requirements[i.id].join(' / '))}</small>`:''}</button>`).join('')}</div><div class="armory-save"><div><strong>${owner?'保存后，稍候约 5 秒再出生查看':'登录 Steam 后保存你的配装'}</strong><p>按兵种独立保存；部分外观随技能装备生效。战斗属性、队伍颜色保持原有规则。</p></div><div>${owner?`<button class="secondary" data-armory="restore" ${saving||!hasPreset?'disabled':''}>恢复游戏内配装</button><button class="primary" data-armory="save" ${saving||!isDirty?'disabled':''}>${saving?'正在保存…':'保存此兵种'}</button>`:'<a class="primary" href="/auth/steam">Steam 登录 ↗</a>'}</div></div></section></div>`;
  },
  async click(target){
   const action=target.dataset.armory,c=current();if(saving)return;
   if(action==='reload'){await load();return;}
   if(!c)return;
   if(action==='culture'){culture=target.dataset.id;classId=null;}
   if(action==='class')classId=target.dataset.id;
   if(action==='slot')slot=target.dataset.id;
   if(action==='item'){
    const next=selected(c).filter(id=>catalog.items.find(i=>i.id===id)?.slot!==slot);
    if(target.dataset.id)next.push(target.dataset.id);drafts[c.id]=next;
   }
   if(action==='save'||action==='restore'){
    if(!owner){toast('请先使用 Steam 登录');return;}
    const generation=epoch;saving=true;render();
    try{const saved=await request('/api/armory',{classId:c.id,items:action==='restore'?null:selected(c)});if(generation===epoch&&owner===identity()){profile=saved.classes;delete drafts[c.id];toast(action==='restore'?'已恢复游戏内配装，下次出生查看':'已保存，稍候约 5 秒再出生查看');}}
    catch(e){toast(e.message);}finally{saving=false;}
   }
   render();
  }
 };
}
