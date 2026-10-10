import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {default:worker}=require('../.test-build/worker.js');
const {moveCredits,stripeHmac}=require('../.test-build/core.js');
const {verifyStripe,handleStripeEvent}=require('../.test-build/billing.js');
const {trendScore}=require('../.test-build/trends.js');
const {pollJobs}=require('../.test-build/jobs.js');
const {trustedVideoUrl}=require('../.test-build/providers.js');
function makeEnv(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
 const media=new Map();
 const bind=(sql,args=[])=>({sql,args,
   bind(...x){return bind(sql,x)},
   async first(){return sqlite.prepare(sql).get(...args)||null},
   async all(){return {results:sqlite.prepare(sql).all(...args)}},
   async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:result.changes,last_row_id:result.lastInsertRowid}}},
 });
 const DB={prepare(sql){return bind(sql)}, async batch(stmts){
    sqlite.exec('BEGIN');try{const results=[];for(const stmt of stmts){const r=sqlite.prepare(stmt.sql).run(...stmt.args);results.push({meta:{changes:r.changes,last_row_id:r.lastInsertRowid}})}sqlite.exec('COMMIT');return results;}
    catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
 const MEDIA={put:async(k,v,meta)=>{media.set(k,{body:v,httpMetadata:meta?.httpMetadata})}, get:async k=>media.has(k)?{...media.get(k),arrayBuffer:async()=>media.get(k).body}:null,delete:async k=>{media.delete(k)}};
 const ASSETS={fetch:async request=>new Response(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'))};
 return {sqlite,DB,MEDIA,ASSETS,SESSION_SECRET:'example-unit-test-secret-not-real-1234567890',
    VIDEO_PROVIDER:'disabled',WEB_BASE_URL:'https://trendmint.example.com',REGISTRATION_ENABLED:'true'};
}
async function call(env,method,path,body,cookie='',csrf=''){
 const headers={...(cookie?{cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),
  ...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})};
 const req=new Request('https://trendmint.example.com'+path,{method,headers,body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});
 const pending=[];
 const response=await worker.fetch(req,env,{waitUntil(p){pending.push(p)}});
 await Promise.all(pending);return response;
}
async function auth(env){
 const r=await call(env,'POST','/api/auth/register',{email:'example@example.com',password:'long-password-for-test-123'});
 assert.equal(r.status,200);
 const cookies=r.headers.getSetCookie();
 const token=cookies.map(x=>x.split(';')[0]).join('; '),csrf=cookies.find(x=>x.startsWith('tm_csrf='))?.split(';')[0].split('=')[1];
 return {cookie:token,csrf,user:await r.json()};
}
test('public health does not fake configured providers',async()=>{
 const env=makeEnv(),r=await call(env,'GET','/api/health');assert.equal(r.status,200);
 const obj=await r.json();assert.equal(obj.mode,'live');assert.equal(obj.real_video_configured,false);assert.equal(obj.payments_configured,false);
});
test('public templates are seeded and have no private prompt',async()=>{
 const env=makeEnv();const r=await call(env,'GET','/api/public/templates');const arr=await r.json();assert.equal(arr.length,4);assert.equal(arr[0].prompt,undefined);
});
test('registration gives 0 credits, normal user cannot admin',async()=>{
 const env=makeEnv(),a=await auth(env);assert.equal(a.user.credits,0);assert.equal(a.user.is_admin,false);
 const r=await call(env,'GET','/api/admin/templates',undefined,a.cookie);assert.equal(r.status,403);
});
test('csrf missing blocks logout and cannot topup in live mode',async()=>{
 const env=makeEnv(),a=await auth(env);
 assert.equal((await call(env,'POST','/api/auth/logout',undefined,a.cookie)).status,403);
 assert.equal((await call(env,'POST','/api/billing/demo-topup',undefined,a.cookie,a.csrf)).status,404);
 assert.equal((await call(env,'POST','/api/auth/logout',undefined,a.cookie,a.csrf)).status,200);
});
test('correct login / rejected bad password / capped retries',async()=>{
 const env=makeEnv();await auth(env);
 const bad=await call(env,'POST','/api/auth/login',{email:'example@example.com',password:'wrong'});assert.equal(bad.status,401);
 const good=await call(env,'POST','/api/auth/login',{email:'example@example.com',password:'long-password-for-test-123'});assert.equal(good.status,200);
});
test('credit ledger is idempotent and cannot overspend',async()=>{
 const env=makeEnv();await auth(env);const uid=env.sqlite.prepare('SELECT id FROM users').get().id;
 assert.equal(await moveCredits(env,uid,10,'test-funding','fund-1'),true);
 assert.equal(await moveCredits(env,uid,10,'same-ref','fund-1'),false);
 assert.equal(await moveCredits(env,uid,-6,'video-1','job-1'),true);
 assert.equal(await moveCredits(env,uid,-6,'video-2','job-2'),false);
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,4);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM credit_entries').get().n,2);
});
test('fal submission disabled without real provider key',async()=>{
 const env=makeEnv(),a=await auth(env),fd=new FormData();fd.set('template_id','1');fd.set('agree_rights','true');fd.set('image',new File([new Uint8Array([255,216,255,0])],'photo.jpg',{type:'image/jpeg'}));
 const r=await call(env,'POST','/api/jobs',fd,a.cookie,a.csrf);assert.equal(r.status,503);
});
test('signed Stripe event grants credits once even with new event ID',async()=>{
 const env=makeEnv();await auth(env);env.STRIPE_WEBHOOK_SECRET='test-webhook-secret';
 env.sqlite.prepare(`INSERT INTO orders(id,user_id,product_id,amount_cents,credits,kind,status,checkout_id) VALUES('ord1',1,'spark',490,20,'pack','pending','cs_test_1')`).run();
 const event={id:'evt_1',type:'checkout.session.completed',data:{object:{id:'cs_test_1',mode:'payment',payment_status:'paid',currency:'usd',amount_total:490,customer:'cus_x',metadata:{order_id:'ord1',user_id:'1',product_id:'spark'}}}};
 const ts=Math.floor(Date.now()/1000),raw=JSON.stringify(event),sig=await stripeHmac(`${ts}.${raw}`,env.STRIPE_WEBHOOK_SECRET);
 const verified=await verifyStripe(raw,`t=${ts},v1=${sig}`,env.STRIPE_WEBHOOK_SECRET);
 assert.equal(verified.id,event.id);assert.equal(await handleStripeEvent(env,event),'processed');
 assert.equal(await handleStripeEvent(env,event),'duplicate');
 assert.equal(await handleStripeEvent(env,{...event,id:'evt_2'}),'processed');
 assert.equal(env.sqlite.prepare('SELECT credits FROM users WHERE id=1').get().credits,20);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM revenue_events').get().n,1);
});
test('tampered Stripe signature rejected',async()=>{
 await assert.rejects(()=>verifyStripe('{"id":"evt_1"}',`t=${Math.floor(Date.now()/1000)},v1=abcd`,'secret'),/签名/);
});
test('manually scored trend has no invented growth signal',async()=>{
 const base={growth_pct:null,demand:3,willingness:3,opportunity:3,feasibility:3,compliance:3};
 assert.equal(trendScore(base),45);
});
test('SEO response serves canonical and noindex on internal dashboard',async()=>{
 const env=makeEnv();const resp=await call(env,'GET','/dashboard');const html=await resp.text();
 assert.equal(resp.status,200);assert.ok(html.includes('noindex,nofollow'));
 const t=await call(env,'GET','/t/pet-popstar');assert.equal(t.status,200);assert.ok((await t.text()).includes('AI Pet Popstar'));
});

function wanEnv(){return Object.assign(makeEnv(),{VIDEO_PROVIDER:'dashscope',DASHSCOPE_API_KEY:'unit-test-only-key',DASHSCOPE_WORKSPACE_ID:'llm-test-space',DASHSCOPE_REGION:'cn-beijing',VIDEO_COST_ESTIMATE_USD:'0.50',MAX_DAILY_VIDEO_BUDGET_USD:'5'});}
function photoForm(){
 const bytes=new Uint8Array(32).fill(255);bytes.set([255,216,255]);
 const fd=new FormData();fd.set('template_id','1');fd.set('agree_rights','true');fd.set('image',new File([bytes],'photo.jpg',{type:'image/jpeg'}));return fd;
}
const wanBase='https://llm-test-space.cn-beijing.maas.aliyuncs.com/api/v1';
const videoUrl='https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test/video.mp4';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('Wan submits once, polls asynchronously, stores privately and checks download ownership',async t=>{
 const env=wanEnv(),a=await auth(env);await moveCredits(env,a.user.id,12,'test','wan-fund');
 let submits=0,status='RUNNING';
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url===wanBase+'/services/aigc/video-generation/video-synthesis'){
   submits++;assert.equal(opts.headers.Authorization,'Bearer unit-test-only-key');assert.equal(opts.headers['X-DashScope-Async'],'enable');assert.equal(opts.redirect,'error');
   const body=JSON.parse(opts.body);assert.equal(body.model,'wan3.0-video');assert.deepEqual(body.parameters,{resolution:'720P',ratio:'adaptive',duration:5,audio:true,prompt_extend:true});
   assert.equal(body.input.media[0].type,'first_frame');
   const encoded=body.input.media[0].url.split(',')[1];assert.match(encoded,/^[a-zA-Z0-9+/]+=*$/);assert.ok(encoded.endsWith('='));assert.equal(Buffer.from(encoded,'base64').length,32);
   return json({output:{task_id:'wan-task-1',task_status:'PENDING'}});
  }
  if(url===wanBase+'/tasks/wan-task-1')return json({output:{task_id:'wan-task-1',task_status:status,video_url:status==='SUCCEEDED'?videoUrl:undefined}});
  if(url===videoUrl){assert.equal(opts.headers,undefined);return new Response(new Uint8Array(2048));}
  throw Error('Unexpected request '+url);
 });
 assert.equal((await (await call(env,'GET','/api/health')).json()).real_video_configured,true);
 const r=await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf);assert.equal(r.status,201);
 const job=await r.json();assert.equal(job.provider,'dashscope');assert.equal(submits,1);
 await pollJobs(env);assert.equal(env.sqlite.prepare('SELECT status FROM jobs').get().status,'processing');
 status='SUCCEEDED';await pollJobs(env);await pollJobs(env);assert.equal(submits,1);
 const saved=env.sqlite.prepare('SELECT * FROM jobs').get();assert.equal(saved.status,'completed');assert.equal(saved.input_key,job.input_key);
 assert.equal(await env.MEDIA.get(saved.input_key),null);assert.ok(await env.MEDIA.get(saved.output_key));
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,6);
 const download=await call(env,'GET',`/api/jobs/${saved.id}/download`,undefined,a.cookie);assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,2048);
 assert.equal((await call(env,'GET',`/api/jobs/${saved.id}/download`)).status,401);
 env.sqlite.prepare("INSERT INTO users(email,password_hash) VALUES('other@example.com','unused')").run();
 const {issueSession}=require('../.test-build/core.js');const other=(await issueSession({id:2},env)).map(x=>x.split(';')[0]).join('; ');
 assert.equal((await call(env,'GET',`/api/jobs/${saved.id}/download`,undefined,other)).status,404);
});
test('missing Wan credentials or workspace disables generation before charging',async()=>{
 for(const missing of ['DASHSCOPE_API_KEY','DASHSCOPE_WORKSPACE_ID']){
  const env=wanEnv();delete env[missing];const a=await auth(env);
  assert.equal((await (await call(env,'GET','/api/health')).json()).real_video_configured,false);
  assert.equal((await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf)).status,503);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM credit_entries').get().n,0);
 }
});
test('insufficient credits do not mint a failed-create refund',async()=>{
 const env=wanEnv(),a=await auth(env);
 assert.equal((await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf)).status,402);
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,0);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM credit_entries').get().n,0);
});
test('Wan provider failure refunds credits once and removes input',async t=>{
 const env=wanEnv(),a=await auth(env);await moveCredits(env,a.user.id,6,'test','wan-fund');
 t.mock.method(globalThis,'fetch',async(url)=>url.endsWith('video-synthesis')?json({output:{task_id:'wan-fail-1',task_status:'PENDING'}}):json({output:{task_status:'FAILED',code:'DataInspectionFailed',message:env.DASHSCOPE_API_KEY}}));
 const r=await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf);assert.equal(r.status,201);
 await pollJobs(env);await pollJobs(env);
 const job=env.sqlite.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'failed');assert.ok(!job.error.includes(env.DASHSCOPE_API_KEY));assert.equal(await env.MEDIA.get(job.input_key),null);
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,6);
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM credit_entries WHERE ref LIKE '%:refund'").get().n,1);
});
test('Wan rejected submission is sanitized and refunded',async t=>{
 const env=wanEnv(),a=await auth(env);await moveCredits(env,a.user.id,6,'test','wan-fund');
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({code:'InvalidApiKey',message:env.DASHSCOPE_API_KEY}),{status:401}));
 await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf);
 const job=env.sqlite.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'failed');assert.match(job.error,/InvalidApiKey/);assert.ok(!job.error.includes(env.DASHSCOPE_API_KEY));
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,6);
});
test('daily budget includes queued SQL timestamps and concurrent reservations',async t=>{
 const env=wanEnv(),a=await auth(env);await moveCredits(env,a.user.id,30,'test','wan-fund');
 env.MAX_DAILY_VIDEO_BUDGET_USD='0.50';
 t.mock.method(globalThis,'fetch',async()=>json({output:{task_id:'budget-1',task_status:'PENDING'}}));
 // A legacy queued job uses SQLite's space-separated timestamp, not ISO format.
 env.sqlite.prepare("INSERT INTO jobs(id,user_id,template_id,status,cost_credits,estimated_cost_usd,provider) VALUES('old-queued',1,1,'queued',6,0.50,'fal')").run();
 assert.equal((await call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf)).status,429);
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,30);
 env.sqlite.prepare("DELETE FROM jobs WHERE id='old-queued'").run();
 const results=await Promise.all([call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf),call(env,'POST','/api/jobs',photoForm(),a.cookie,a.csrf)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,1);
 assert.equal(env.sqlite.prepare('SELECT credits FROM users').get().credits,24);
});
test('video downloads reject foreign, credential-bearing and non-HTTPS URLs',()=>{
 assert.equal(trustedVideoUrl(videoUrl,'dashscope'),true);
 for(const url of ['https://evil.example/video.mp4','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.example/v','https://user:secret@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v','http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/v'])assert.equal(trustedVideoUrl(url,'dashscope'),false);
});

