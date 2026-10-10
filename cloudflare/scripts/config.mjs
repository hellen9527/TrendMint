import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function buildConfig(env=process.env) {
const d1 = env.CLOUDFLARE_D1_DATABASE_ID || '00000000-0000-0000-0000-000000000000';
const account = env.CLOUDFLARE_ACCOUNT_ID;
const provider=env.VIDEO_PROVIDER||'disabled';
if(!['disabled','dashscope','fal'].includes(provider))throw Error('Unsupported VIDEO_PROVIDER');
const workspace=env.DASHSCOPE_WORKSPACE_ID||'',region=env.DASHSCOPE_REGION||'cn-beijing';
if(provider==='dashscope'&&(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(workspace)||!['cn-beijing','ap-southeast-1'].includes(region)))throw Error('Configure a valid DASHSCOPE_WORKSPACE_ID and matching DASHSCOPE_REGION (cn-beijing or ap-southeast-1)');
const wanAudio=env.WAN_AUDIO||'false';
if(!['true','false'].includes(wanAudio))throw Error('WAN_AUDIO must be true or false');
const defaultCost=provider==='fal'?'0.50':region==='ap-southeast-1'?(wanAudio==='true'?'0.28':'0.14'):(wanAudio==='true'?'0.24':'0.12');
const cost=env.VIDEO_COST_ESTIMATE_USD||defaultCost,budget=env.MAX_DAILY_VIDEO_BUDGET_USD||'5';
if(!Number.isFinite(Number(cost))||!Number.isFinite(Number(budget))||Number(cost)<=0||Number(budget)<=0)throw Error('Invalid video budget');
const cfg = {
  name: 'trendmint', main: 'src/worker.ts', compatibility_date: '2026-10-09',
  assets: { directory: './public', binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding:'DB', database_name:'trendmint-db', database_id:d1, migrations_dir:'migrations' }],
  r2_buckets: [{ binding:'MEDIA', bucket_name: env.CLOUDFLARE_R2_BUCKET || 'trendmint-media' }],
  triggers: { crons:['*/5 * * * *', '0 3 * * *'] },
  vars: { VIDEO_PROVIDER: provider, FAL_MODEL_ID:env.FAL_MODEL_ID||'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
    DASHSCOPE_WORKSPACE_ID:workspace,DASHSCOPE_REGION:region,
    WAN_AUDIO:wanAudio,
    VIDEO_COST_ESTIMATE_USD:cost, MAX_DAILY_VIDEO_BUDGET_USD:budget, REGISTRATION_ENABLED:'true', WEB_BASE_URL:env.TRENDMINT_BASE_URL || 'https://trendmint.fategenie.com' },
  observability:{enabled:true}
};
if(account)cfg.account_id=account;

// Domain binding is opt-in to avoid conflicting with existing fategenie.com applications.
if (env.TRENDMINT_CUSTOM_DOMAIN === 'true') {
  cfg.routes = [{pattern:'trendmint.fategenie.com',custom_domain:true}];
  cfg.workers_dev = true;
}
return cfg;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const cfg=buildConfig();
 if(cfg.d1_databases[0].database_id.startsWith('000000'))console.log('Generated local configuration. Set CLOUDFLARE_D1_DATABASE_ID before remote deploy.');
 writeFileSync(new URL('../wrangler.generated.json',import.meta.url), JSON.stringify(cfg,null,2));
}

