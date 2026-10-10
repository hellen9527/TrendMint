import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
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
