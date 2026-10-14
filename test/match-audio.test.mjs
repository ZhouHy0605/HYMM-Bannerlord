import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCue,MatchAudio} from '../public/match-audio.js';
const room=(phase,extra={})=>({id:'m1',phase,leg:0,players:['me','other'],ready:[],captains:['me','other'],turn:0,picks:[],teams:[['me'],['other']],...extra});
const state=m=>({mode:'ranked',me:{id:'me'},current:m,matches:m?[m]:[]});
test('ready and captain turns notify only the participant required to act',()=>{
 assert.equal(matchCue(null,state(room('ready'))).kind,'ready');
 assert.equal(matchCue(null,state(room('ready',{ready:['me']}))),null);
 assert.equal(matchCue(null,state(room('draft',{turn:1}))),null);
 const a=matchCue(null,state(room('draft'))),b=matchCue(null,state(room('draft',{picks:['a','b','c']})));
 assert.equal(a.kind,'pick');assert.notEqual(a.key,b.key);
 assert.equal(matchCue(null,{...state(room('ready')),me:{id:'outsider'}}),null);
});
test('phase cues cover draft, preparation, both starts, halftime, review and terminal results without historical replay',()=>{
 const ready=state(room('ready')),draft=state(room('draft',{turn:1})),waiting=state(room('awaiting_server')),live=state(room('live'));
 assert.equal(matchCue(ready,draft).kind,'draft');assert.equal(matchCue(draft,waiting).kind,'prepare');assert.equal(matchCue(waiting,live).kind,'live');
 const half=state(room('awaiting_server',{leg:1})),second=state(room('live',{leg:1}));
 assert.equal(matchCue(live,half).kind,'halftime');assert.notEqual(matchCue(waiting,live).key,matchCue(half,second).key);
 assert.equal(matchCue(live,state(room('review'))).kind,'review');
 for(const [winner,kind] of [[0,'win'],[1,'loss'],[null,'draw']]){
  const end={...state(null),matches:[room('settled',{winner})]};assert.equal(matchCue(live,end).kind,kind);assert.equal(matchCue(null,end),null);
 }
 assert.equal(matchCue(ready,{...state(null),matches:[room('cancelled')]}).kind,'cancel');
});
test('polling duplicates and muted events do not replay; a no-longer-actionable pending cue is discarded',()=>{
 const a=new MatchAudio(),played=[];a.context={state:'running'};a.play=k=>played.push(k);
 const r=state(room('ready'));a.update(null,r);a.update(r,r);assert.deepEqual(played,['ready']);
 a.muted=true;a.update(r,state(room('draft')));a.muted=false;a.update(r,state(room('draft')));assert.deepEqual(played,['ready']);
 const blocked=new MatchAudio();blocked.update(null,r);assert.equal(blocked.pending.kind,'ready');
 blocked.update(r,state(room('ready',{ready:['me']})));assert.equal(blocked.pending,null);
});
