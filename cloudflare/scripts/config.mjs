import { writeFileSync } from 'node:fs';
const d1 = process.env.CLOUDFLARE_D1_DATABASE_ID || '00000000-0000-0000-0000-000000000000';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfg = {
  name: 'trendmint', main: 'src/worker.ts', compatibility_date: '2026-10-09',
  assets: { directory: './public', binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding:'DB', database_name:'trendmint-db', database_id:d1, migrations_dir:'migrations' }],
  r2_buckets: [{ binding:'MEDIA', bucket_name: process.env.CLOUDFLARE_R2_BUCKET || 'trendmint-media' }],
  triggers: { crons:['*/5 * * * *', '0 3 * * *'] },
  vars: { VIDEO_PROVIDER: 'disabled', FAL_MODEL_ID:'fal-ai/kling-video/v2.5-turbo/standard/image-to-video',
    VIDEO_COST_ESTIMATE_USD:'0.50', MAX_DAILY_VIDEO_BUDGET_USD:'10', REGISTRATION_ENABLED:'true', WEB_BASE_URL:process.env.TRENDMINT_BASE_URL || 'https://trendmint.fategenie.com' },
  observability:{enabled:true}
};
if(account)cfg.account_id=account;
if(d1.startsWith('000000')) console.log('Generated local configuration. Set CLOUDFLARE_D1_DATABASE_ID before remote deploy.');

// Domain binding is opt-in to avoid conflicting with existing fategenie.com applications.
if (process.env.TRENDMINT_CUSTOM_DOMAIN === 'true') {
  cfg.routes = [{pattern:'trendmint.fategenie.com',custom_domain:true}];
  cfg.workers_dev = true;
}
writeFileSync(new URL('../wrangler.generated.json',import.meta.url), JSON.stringify(cfg,null,2));
