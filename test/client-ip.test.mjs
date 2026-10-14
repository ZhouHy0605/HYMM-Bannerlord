import test from 'node:test';import assert from 'node:assert/strict';import {clientIP} from '../client-ip.mjs';
test('local reverse proxy preserves separate client rate buckets without trusting public spoofed headers',()=>{
 const req=(ip,header)=>({socket:{remoteAddress:ip},headers:{'x-forwarded-for':header}});
 assert.equal(clientIP(req('127.0.0.1','203.0.113.1'),true),'203.0.113.1');
 assert.equal(clientIP(req('127.0.0.1','spoof, 203.0.113.2'),true),'203.0.113.2');
 assert.equal(clientIP(req('203.0.113.3','203.0.113.4'),true),'203.0.113.3');
 assert.equal(clientIP(req('127.0.0.1','invalid'),true),'127.0.0.1');
 assert.equal(clientIP(req('127.0.0.1','203.0.113.1')),'127.0.0.1');
});
