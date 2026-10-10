/** Provision ONLY TrendMint's dedicated Cloudflare D1 and R2 resources.
 * Idempotent and safe for repeat CI deployments; never deletes resources.
 */
import {appendFileSync} from 'node:fs';

export async function provision(env, request = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[0-9a-f]{32}$/i.test(account || '')) {
    throw new Error('Configure CLOUDFLARE_API_TOKEN and 32-character CLOUDFLARE_ACCOUNT_ID as GitHub secrets.');
  }
  const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function api(method, path, body) {
    const r = await request(apiRoot + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {'Content-Type':'application/json'} : {})
      },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    let data;
    try { data = await r.json(); }
    catch { throw new Error(`Cloudflare ${method} ${path}: HTTP ${r.status}, invalid response`); }
    if (!r.ok || data.success === false) {
      const errors = (data.errors || []).map(e => e.message || e.code).join(', ');
      throw new Error(`Cloudflare ${method} ${path}: HTTP ${r.status}: ${errors || 'API error'}`);
    }
    return data;
  }

  const dbName = 'trendmint-db';
  const list = await api('GET', `/d1/database?name=${dbName}&per_page=20`);
  const matching = (list.result || []).filter(v => v.name === dbName);
  if (matching.length > 1) throw new Error(`Ambiguous D1 database name ${dbName}`);
  let db = matching[0];
  if (!db) {
    const created = await api('POST', '/d1/database', {name:dbName});
    db = created.result;
    console.log('Created D1 database trendmint-db');
  } else console.log('Using existing D1 database trendmint-db');
  if (!/^[0-9a-f-]{36}$/i.test(db?.uuid || '')) throw new Error('Cloudflare D1 response did not contain a valid database UUID');

  const bucketName = 'trendmint-media';
  const bucketList = await api('GET', `/r2/buckets?name_contains=${bucketName}&per_page=50`);
  const found = (bucketList.result?.buckets || []).some(v => v.name === bucketName);
  if (!found) {
    await api('POST', '/r2/buckets', {name:bucketName});
    console.log('Created private R2 bucket trendmint-media');
  } else console.log('Using existing R2 bucket trendmint-media');

  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `database_id=${db.uuid}\n`);
  return {database_id:db.uuid,bucket:bucketName};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  provision(process.env).then(r => console.log(`TrendMint resources ready: D1 ${r.database_id}, R2 ${r.bucket}`)).catch(e => {console.error(e.message);process.exitCode=1;});
}
