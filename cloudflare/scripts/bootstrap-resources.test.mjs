import test from 'node:test';
import assert from 'node:assert/strict';
import {provision} from './bootstrap-resources.mjs';
const env={CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ACCOUNT_ID:'1'.repeat(32)};
const uuid='11111111-2222-3333-4444-555555555555';
const response = data => ({ok:true,status:200,json:async()=>({success:true,result:data})});
test('provision reuses existing named D1 and R2 without writes',async()=>{
  const calls=[];
  const result=await provision(env,async(url,opts)=>{
    calls.push(opts.method+' '+new URL(url).pathname);
    if(url.includes('/d1/database'))return response([{name:'trendmint-db',uuid}]);
    return response({buckets:[{name:'trendmint-media'}]});
  });
  assert.equal(result.database_id,uuid);
  assert.equal(calls.length,2);
  assert.equal(calls.every(x=>x.startsWith('GET ')),true);
});
test('provision creates only TrendMint D1 and R2 if missing',async()=>{
  const calls=[];
  const result=await provision(env,async(url,opts)=>{
    calls.push([opts.method,new URL(url).pathname,opts.body?JSON.parse(opts.body):null]);
    if(url.includes('/d1/database')&&opts.method==='GET')return response([]);
    if(url.includes('/d1/database'))return response({name:'trendmint-db',uuid});
    if(url.includes('/r2/buckets')&&opts.method==='GET')return response({buckets:[]});
    return response({name:'trendmint-media'});
  });
  assert.equal(result.database_id,uuid);
  assert.deepEqual(calls.filter(x=>x[0]==='POST').map(x=>x[2]),[{name:'trendmint-db'},{name:'trendmint-media'}]);
});
test('provision requires credentials',async()=>{
  await assert.rejects(provision({CLOUDFLARE_API_TOKEN:'anything'}),/Configure/);
});
