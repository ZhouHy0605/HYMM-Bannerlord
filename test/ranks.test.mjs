import test from 'node:test';
import assert from 'node:assert/strict';
import {rank} from '../engine.mjs';
test('WBMM ten rank thresholds, promotions and demotions',()=>{
 const names=['小丑','农民','卫兵','骑士','骑士长','领主','公爵','亲王','国王','皇帝'];
 const thresholds=[800,1200,1400,1600,2000,2400,3000,3600,4000];
 thresholds.forEach((n,i)=>{assert.equal(rank(n-1),names[i]);assert.equal(rank(n),names[i+1]);});
 assert.equal(rank(1000),'农民');assert.equal(rank(-10),'小丑');assert.equal(rank(10000),'皇帝');
});
