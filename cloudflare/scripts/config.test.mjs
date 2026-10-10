import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {buildConfig} from './config.mjs';
test('Wan configuration never serializes secrets and only binds the isolated subdomain',()=>{
 const cfg=buildConfig({VIDEO_PROVIDER:'dashscope',DASHSCOPE_WORKSPACE_ID:'llm-test-space',DASHSCOPE_API_KEY:'unit-test-key',TRENDMINT_CUSTOM_DOMAIN:'true'});
 assert.equal(cfg.vars.VIDEO_PROVIDER,'dashscope');assert.equal(cfg.vars.DASHSCOPE_REGION,'cn-beijing');
 assert.equal(cfg.vars.MAX_DAILY_VIDEO_BUDGET_USD,'5');
 assert.ok(!JSON.stringify(cfg).includes('unit-test-key'));assert.deepEqual(cfg.routes,[{pattern:'trendmint.fategenie.com',custom_domain:true}]);
 assert.equal(buildConfig({}).vars.VIDEO_PROVIDER,'disabled');
 assert.throws(()=>buildConfig({VIDEO_PROVIDER:'dashscope'}),/WORKSPACE/);
 assert.throws(()=>buildConfig({VIDEO_PROVIDER:'dashscope',DASHSCOPE_WORKSPACE_ID:'evil.test/path'}),/WORKSPACE/);
 assert.throws(()=>buildConfig({VIDEO_COST_ESTIMATE_USD:'Infinity'}),/budget/);
});
test('worker entry and routes are present',()=>{
 const src=readFileSync(new URL('../src/worker.ts',import.meta.url),'utf8');
 for(const route of ['/api/health','/api/public/templates','/api/jobs','/api/billing/stripe-webhook','/api/admin/trends'])assert.ok(src.includes(route),route);
});
test('cloudflare UI never silently demo logs-in',()=>{
 const js=readFileSync(new URL('../public/static/app.js',import.meta.url),'utf8');
 assert.ok(js.includes("if(S.health?.mode==='demo')return demoLogin()"));
});
test('schema has required indexes and billing ledger',()=>{
 const sql=readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8');
 for(const t of ['users','templates','credit_entries','jobs','stripe_events','revenue_events','rate_limits'])assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS '+t));
});

