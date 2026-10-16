import {matchSamples} from './audio-assets.js';
const melodies={
 ready:[[523,0,.16],[659,.2,.16],[784,.4,.3],[523,.9,.16],[659,1.1,.16],[784,1.3,.35]],
 election:[[523,0,.18],[784,.24,.3]],
 pick:[[659,0,.14],[880,.2,.25]],draft:[[392,0,.15],[523,.2,.22]],
 prepare:[[392,0,.16],[494,.2,.16],[587,.4,.25]],
 live:[[392,0,.18],[523,.22,.18],[784,.44,.35]],
 halftime:[[587,0,.2],[440,.25,.2],[659,.5,.3]],
 win:[[523,0,.18],[659,.22,.18],[784,.44,.18],[1047,.7,.4]],
 loss:[[440,0,.22],[392,.28,.22],[330,.56,.35]],
 draw:[[523,0,.2],[587,.26,.2],[523,.52,.35]],
 cancel:[[440,0,.2],[330,.28,.3]],review:[[440,0,.18],[440,.3,.3]],preview:[[659,0,.15],[784,.2,.25]]
};
export function matchCue(previous,next){
 const id=next.me?.id;if(!id)return null;
 const m=next.current;
 const cue=(room,kind,step=room.leg||0)=>({key:[next.mode,id,room.id,kind,step].join(':'),kind});
 if(m?.players.includes(id)){
  if(m.phase==='ready'&&!m.ready.includes(id))return cue(m,'ready');
  if(m.phase==='election')return cue(m,'election');
  if(m.phase==='draft'){
   if(m.captains[m.turn]===id)return cue(m,'pick',m.picks.length);
   if(previous?.current?.id===m.id&&['ready','election'].includes(previous.current.phase))return cue(m,'draft');
  }
  if(previous?.current?.id===m.id&&(previous.current.phase!==m.phase||previous.current.leg!==m.leg)){
   if(m.phase==='awaiting_server')return cue(m,m.leg===1?'halftime':'prepare');
   if(m.phase==='live')return cue(m,'live');
   if(m.phase==='review')return cue(m,'review');
  }
 }
 const old=previous?.current;
 if(old?.players.includes(id)){
  const ended=next.matches?.find(r=>r.id===old.id);
  if(ended?.phase==='cancelled')return cue(ended,'cancel');
  if(ended?.phase==='settled')return cue(ended,ended.winner===null?'draw':ended.teams[ended.winner]?.includes(id)?'win':'loss');
 }
 return null;
}
export class MatchAudio {
 constructor(onChange=()=>{}){
  this.onChange=onChange;this.context=null;this.pending=null;this.nodes=new Set();this.buffers=new Map();this.generation=0;this.identity=null;
  try{this.muted=localStorage.getItem('hymm-sound-muted')==='1';}catch{this.muted=false;}
  try{this.seen=new Set(JSON.parse(sessionStorage.getItem('hymm-sound-seen')||'[]'));}catch{this.seen=new Set();}
 }
 get label(){return this.muted?'提示音：关':this.context?.state==='running'?'提示音：开':'启用提示音';}
 get enabled(){return !this.muted&&this.context?.state==='running';}
 async unlock(){
  if(this.muted)return;
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   this.context??=new Audio();await this.context.resume();
   for(const kind of ['ready','win'])void this.loadSample(kind).catch(()=>{});
   if(this.pending&&Date.now()<this.pending.expires){this.play(this.pending.kind);this.pending=null;}
  }catch{}finally{this.onChange();}
 }
 async toggle(){
  if(this.muted){this.muted=false;await this.unlock();this.play('preview');}
  else if(!this.enabled){await this.unlock();this.play('preview');}
  else{this.muted=true;this.generation++;this.pending=null;for(const n of this.nodes){try{n.stop();}catch{}}}
  try{localStorage.setItem('hymm-sound-muted',this.muted?'1':'0');}catch{}
  this.onChange();
 }
 update(previous,next){
  const m=next.current,identity=[next.me?.id,m?.id,m?.phase,m?.leg,m?.picks?.length,m?.ready?.includes(next.me?.id)].join(':');
  if(this.identity!==identity){this.identity=identity;this.generation++;}
  if(this.pending?.identity!==identity)this.pending=null;
  const cue=matchCue(previous,next);if(!cue||this.seen.has(cue.key))return;
  this.seen.add(cue.key);if(this.seen.size>200)this.seen.delete(this.seen.values().next().value);
  try{sessionStorage.setItem('hymm-sound-seen',JSON.stringify([...this.seen]));}catch{}
  if(this.muted)return;
  if(this.enabled)this.play(cue.kind);else this.pending={...cue,identity,expires:Date.now()+30000};
 }
 loadSample(kind){
  const url=matchSamples[kind==='preview'?'ready':kind];
  if(!url)return Promise.resolve(null);
  if(!this.buffers.has(url)){
   const ctx=this.context;
   const loading=fetch(url,{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('Audio unavailable');return r.arrayBuffer();}).then(bytes=>ctx.decodeAudioData(bytes)).catch(error=>{this.buffers.delete(url);throw error;});
   this.buffers.set(url,loading);
  }
  return this.buffers.get(url);
 }
 async play(kind){
  if(!this.enabled)return;
  const generation=++this.generation;
  if(matchSamples[kind==='preview'?'ready':kind]){
   let buffer;
   try{buffer=await this.loadSample(kind);}catch{}
   if(!this.enabled||generation!==this.generation)return;
   if(buffer){
    const ctx=this.context,source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=buffer;gain.gain.value=.65;source.connect(gain);gain.connect(ctx.destination);
    this.nodes.add(source);source.onended=()=>{this.nodes.delete(source);source.disconnect();gain.disconnect();};
    source.start();return;
   }
  }
  this.playMelody(kind);
 }
 playMelody(kind){
  if(!this.enabled)return;
  const ctx=this.context,start=ctx.currentTime+.02;
  // Retain synthesized cues for other phases and for failed sample downloads.
  for(const [frequency,offset,duration] of melodies[kind]||[]){
   const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.type='sine';oscillator.frequency.value=frequency;
   gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(.12,start+offset+.015);
   gain.gain.exponentialRampToValueAtTime(.001,start+offset+duration);oscillator.connect(gain);gain.connect(ctx.destination);
   this.nodes.add(oscillator);oscillator.onended=()=>{this.nodes.delete(oscillator);oscillator.disconnect();gain.disconnect();};
   oscillator.start(start+offset);oscillator.stop(start+offset+duration+.02);
  }
 }
}
