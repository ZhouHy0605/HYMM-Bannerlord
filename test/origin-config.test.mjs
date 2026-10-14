import test from 'node:test';
import assert from 'node:assert/strict';
import {originConfig} from '../origin-config.mjs';
test('Public HTTP is opt-in; HTTPS remains secure and direct port cannot open accidentally',()=>{
 assert.equal(originConfig({}).secure,false);
 assert.throws(()=>originConfig({PUBLIC_ORIGIN:'http://203.0.113.10:7233'}),/requires HTTPS/);
 assert.equal(originConfig({PUBLIC_ORIGIN:'https://play.example.com',ALLOW_INSECURE_HTTP_TEST:'1'}).secure,true);
 const env={PUBLIC_ORIGIN:'http://203.0.113.10:7233',ALLOW_INSECURE_HTTP_TEST:'1',PUBLIC_HTTP_TEST_PORT:'7233'};
 assert.deepEqual(originConfig(env),{origin:env.PUBLIC_ORIGIN,secure:false,publicTestPort:7233});
 for(const change of [{ALLOW_INSECURE_HTTP_TEST:'0'},{PUBLIC_ORIGIN:'https://play.example.com:7233'},{PUBLIC_HTTP_TEST_PORT:'3210'},{PUBLIC_HTTP_TEST_PORT:'7234'},{PUBLIC_HTTP_TEST_PORT:'NaN'}])assert.throws(()=>originConfig({...env,...change}));
});
