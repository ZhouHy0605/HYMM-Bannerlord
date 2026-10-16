const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=t=>new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(t);
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export function createChat({getState,isActive,toast}){
 let messages=[],draft='',owner='',etag='',timer,controller=null,generation=0,active=false,loaded=false,sending=false,pending=null,status='正在连接…',scrollTop=null;
 const identity=()=>{const s=getState();return (s?.mode||'guest')+':'+(s?.me?.id||'')+':'+!!s?.isAdmin;};
 const root=()=>document.querySelector('[data-chat-root]');
 const canSend=()=>getState()?.mode==='ranked'&&!!getState()?.me;
 async function post(url,data){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':getState()?.csrf||''},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  const result=await r.json();if(!r.ok)throw Error(result.error||'发送失败，请稍后重试');return result;
 }
 function updateControls(){
  const r=root();if(!r)return;
  r.querySelector('[data-chat-status]').textContent=status;
  const count=r.querySelector('[data-chat-count]');if(count)count.textContent=draft.length+' / 500';
  const send=r.querySelector('[data-chat-send]');if(send){send.disabled=sending||!draft.trim();send.textContent=sending?'发送中…':'发送消息 ↗';}
 }
 function schedule(){clearTimeout(timer);timer=null;if(active&&!document.hidden)timer=setTimeout(()=>{timer=null;void poll();},5000);}
 function bottom(){const list=root()?.querySelector('[data-chat-messages]');if(list){list.scrollTop=list.scrollHeight;scrollTop=list.scrollTop;root().querySelector('[data-chat-latest]').hidden=true;}}
 function paint(force=false){
  const r=root(),list=r?.querySelector('[data-chat-messages]');if(!list)return;
  const nearBottom=scrollTop==null||list.scrollHeight-list.clientHeight-list.scrollTop<70;
  const first=[...list.querySelectorAll('[data-message-id]')].find(n=>n.offsetTop+n.offsetHeight>list.scrollTop),anchor=first?{id:first.dataset.messageId,offset:first.offsetTop-list.scrollTop}:null;
  const oldLast=list.lastElementChild?.dataset.messageId;
  list.innerHTML=messages.length?messages.map(m=>{
   if(m.deleted)return `<div class="chat-removed" data-message-id="${m.id}">一条消息已被移除</div>`;
   const own=m.authorId===getState()?.me?.id;
   return `<article class="chat-message ${own?'chat-own':''}" data-message-id="${m.id}"><span class="chat-avatar" aria-hidden="true">${esc(m.name.slice(0,1))}${m.avatar?`<img src="${esc(m.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span><div class="chat-message-body"><div class="chat-byline"><strong>${esc(m.name)}</strong>${own?'<span class="chat-you">你</span>':''}<time datetime="${new Date(m.createdAt).toISOString()}">${stamp(m.createdAt)}</time>${canSend()&&(own||getState().isAdmin)?`<button class="chat-remove" data-chat-remove="${m.id}" aria-label="${own?'撤回自己的消息':'删除 '+esc(m.name)+' 的消息'}">${own?'撤回':'删除'}</button>`:''}</div><p>${esc(m.text)}</p></div></article>`;
  }).join(''):`<div class="chat-empty"><span aria-hidden="true">✦</span><h2>${loaded?'营地还很安静':'正在打开营地'}</h2><p>${loaded?'聊聊刚才的对局，或叫上朋友一起排队。':'稍候片刻，正在读取聊天消息。'}</p></div>`;
  if(force&&scrollTop!=null)list.scrollTop=scrollTop;
  else if(nearBottom)bottom();
  else {const found=anchor&&[...list.children].find(n=>n.dataset.messageId===anchor.id);list.scrollTop=found?found.offsetTop-anchor.offset:scrollTop||0;if(oldLast!==String(messages.at(-1)?.id))r.querySelector('[data-chat-latest]').hidden=false;}
  scrollTop=list.scrollTop;
 }
 async function poll(){
  if(!active||document.hidden||controller)return;
  const epoch=generation,abort=new AbortController();controller=abort;const timeout=setTimeout(()=>abort.abort(),10000);
  try{
   const r=await fetch('/api/chat',{headers:etag?{'If-None-Match':etag}:{},signal:abort.signal,cache:'no-store'});
   if(epoch!==generation||controller!==abort)return;
   if(r.status!==304){const data=await r.json();if(!r.ok)throw Error(data.error||'聊天连接暂时中断');if(epoch!==generation||controller!==abort)return;messages=data.messages;etag=r.headers.get('ETag')||'';loaded=true;paint();}
   status='聊天已连接';
  }catch(e){if(epoch===generation&&controller===abort&&active&&!document.hidden)status='连接中断，正在重试…';}
  finally{clearTimeout(timeout);if(controller===abort){controller=null;if(epoch===generation){updateControls();schedule();}}}
 }
 function syncIdentity(){
  if(owner===identity())return;
  owner=identity();generation++;controller?.abort();controller=null;messages=[];draft='';etag='';loaded=false;pending=null;sending=false;scrollTop=null;status='正在连接…';
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);timer=null;controller?.abort();controller=null;}else if(active)void poll();});
 document.addEventListener('input',e=>{if(e.target.matches('[data-chat-input]')){draft=e.target.value;updateControls();}});
 document.addEventListener('keydown',e=>{if(e.target.matches('[data-chat-input]')&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();e.target.form.requestSubmit();}});
 document.addEventListener('submit',async e=>{
  if(!e.target.matches('[data-chat-form]'))return;e.preventDefault();if(sending||!canSend()||!draft.trim())return;
  const text=draft.trim(),epoch=generation;if(pending?.text!==text)pending={text,nonce:nonce()};
  sending=true;updateControls();
  try{await post('/api/chat',pending);if(owner!==identity()||epoch!==generation)return;pending=null;if(draft.trim()===text){draft='';const input=root()?.querySelector('[data-chat-input]');if(input)input.value='';}etag='';controller?.abort();controller=null;await poll();bottom();}
  catch(e){if(epoch===generation)toast(e.message);}
  finally{if(epoch===generation){sending=false;updateControls();}}
 });
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-chat-latest]')){bottom();return;}
  if(e.target.closest('[data-chat-retry]')){void poll();return;}
  const button=e.target.closest('[data-chat-remove]');if(!button||button.disabled)return;
  const epoch=generation;button.disabled=true;
  try{await post('/api/chat/remove',{id:Number(button.dataset.chatRemove)});if(epoch===generation){etag='';await poll();}}
  catch(e){toast(e.message);}finally{if(button.isConnected)button.disabled=false;}
 });
 return {
  capture(){return {node:root(),owner,focus:document.activeElement?.matches('[data-chat-input]')};},
  view(){
   syncIdentity();
   return `<div data-chat-root><div class="chat-heading"><div><small>HYMM / CAMPFIRE</small><h1>营地聊天</h1><p>战场之外，围坐聊聊。找队友、聊战术，下一局见。</p></div><span class="chat-channel">公共频道</span></div><div class="chat-layout"><section class="chat-board" aria-label="公共聊天"><div class="chat-topline"><div><i></i><strong>营地大厅</strong><small>最近 100 条消息</small></div><button class="chat-status" data-chat-retry title="点击重试连接"><span data-chat-status>${status}</span></button></div><div class="chat-log-wrap"><div class="chat-messages" data-chat-messages role="log" aria-label="聊天消息" aria-live="polite" tabindex="0"></div><button class="chat-latest" data-chat-latest hidden>有新消息 · 查看最新 ↓</button></div>${canSend()?`<form class="chat-compose" data-chat-form><label for="chat-message">以 ${esc(getState().me.name)} 的身份发言</label><textarea id="chat-message" data-chat-input maxlength="500" rows="3" placeholder="说点什么，或约一场遭遇战…" required>${esc(draft)}</textarea><div class="chat-compose-bottom"><span>Ctrl / ⌘ + Enter 发送 · Enter 换行</span><small data-chat-count>${draft.length} / 500</small><button class="primary" data-chat-send>发送消息 ↗</button></div></form>`:`<div class="chat-login"><div><strong>加入营地的谈话</strong><p>使用 Steam 登录后即可发言。</p></div>${getState()?.mode==='demo'?'<span>请先退出模拟训练，再登录 Steam</span>':'<a class="primary" href="/auth/steam">Steam 登录 ↗</a>'}</div>`}</section><aside class="chat-aside"><div class="chat-aside-mark" aria-hidden="true">✦</div><small>在这里，找到你的队友</small><h2>交锋留在战场<br>交流留在营地</h2><p>分享上一局的精彩时刻，也聊聊下一局的战术。</p><div class="chat-etiquette"><strong>营地约定</strong><p>友好交流，不刷屏、不辱骂。公共频道中的消息对所有访客可见。</p><p>每条最多 500 字。可撤回自己的消息；管理员可以删除不合适的内容。</p></div><button class="secondary" data-tab="hall">去匹配大厅 →</button><small class="chat-scope">这里的消息只在网页展示。</small></aside></div></div>`;
  },
  mount(snapshot){
   syncIdentity();const was=active;active=isActive();
   if(!active){clearTimeout(timer);timer=null;controller?.abort();controller=null;return;}
   const r=root();if(!r)return;
   if(snapshot?.node&&snapshot.owner===owner){r.replaceWith(snapshot.node);if(snapshot.focus)snapshot.node.querySelector('[data-chat-input]')?.focus({preventScroll:true});}
   else {paint(true);const list=r.querySelector('[data-chat-messages]');list.addEventListener('scroll',()=>{scrollTop=list.scrollTop;if(list.scrollHeight-list.clientHeight-list.scrollTop<70)root()?.querySelector('[data-chat-latest]')?.setAttribute('hidden','');},{passive:true});}
   updateControls();if(!was||!loaded)void poll();else if(!timer&&!controller)schedule();
  }
 };
}
