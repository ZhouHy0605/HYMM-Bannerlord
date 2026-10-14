import test from 'node:test';
import assert from 'node:assert/strict';
import {ratingVisibility} from '../rating-visibility.mjs';

test('ordinary browser views redact ratings at every nesting level without changing stored data or combat stats', () => {
  const user = {id:'player', name:'Knight', avatar:'/avatar.png', rating:1732, rank:'骑士长', wins:8, losses:2, combat:{adr:94, kd:1.3, kda:1.9, matches:10}};
  const match = {players:['player'], score:[6,4], changes:{player:37}, ratings:{player:{before:1695,after:1732}}, ratingBreakdown:{player:{delta:37}}, ratingRule:'blmm-class-v1', combat:{players:[{id:'player',score:420,kills:12,damage:940}]}};
  const source = {isAdmin:false, me:user, users:{player:user}, queue:[{user}], current:match, matches:[match], ledger:[{delta:37}], leaderboard:[user]};
  const original = structuredClone(source);
  const visible = ratingVisibility(source);
  for (const u of [visible.me,visible.users.player,visible.queue[0].user]) {
    assert.equal(u.rating,undefined);assert.equal(u.rank,undefined);
    assert.equal(u.avatar,user.avatar);assert.deepEqual(u.combat,user.combat);
    assert.equal(u.wins,8);assert.equal(u.losses,2);
  }
  for (const m of [visible.current,...visible.matches]) {
    for (const key of ['changes','ratings','ratingBreakdown','ratingRule']) assert.equal(m[key],undefined);
    assert.deepEqual(m.score,[6,4]);assert.deepEqual(m.combat,match.combat);
  }
  assert.deepEqual(visible.ledger,[]);assert.deepEqual(visible.leaderboard,[]);
  assert.deepEqual(source,original);
  assert.deepEqual(ratingVisibility({...source,isAdmin:true}),{...original,isAdmin:true});
});
