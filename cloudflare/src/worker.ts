import {Env,Ctx,ApiError,one,all,run,j,fail,now,getUser,issueSession,withCookies,userPublic,bodyJson,checkedString,checkedNum,csrfCheck,throttle,hashPassword,verifyPassword,security} from './core';
import {PACKS,billingReady,checkout,billingPortal,wallet,verifyStripe,handleStripeEvent} from './billing';
import {listTrends,addTrend,updateTrend,collectYoutube,promoteDiscovery,reportMarkdown} from './trends';
import {createJob,jobOut,pollJobs,cleanup,downloadJob} from './jobs';
const JSON_HEADERS={'Cache-Control':'no-store'};
function match(path:string,pattern:RegExp){return pattern.exec(path)}
function tid(x:string){return checkedNum(x,'ID',1,100000000)}
const publicTemplate=(t:any)=>({id:t.id,slug:t.slug,title:t.title,title_en:t.title_en,description:t.description,description_en:t.description_en,emoji:t.emoji,tag:t.tag,credits:t.credits});
function validateTemplate(b:any){
 const slug=checkedString(b.slug,'Slug',3,70);
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail(422,'Slug 只能包含英文字母、小写数字和连字符');
 return {slug,title:checkedString(b.title,'中文名称',2,100),title_en:checkedString(b.title_en,'英文名称',3,120),
  description:checkedString(b.description,'描述',6,600),description_en:checkedString(b.description_en,'SEO 描述',6,600),
  prompt:checkedString(b.prompt,'Prompt',30,2500),emoji:checkedString(b.emoji||'✨','图标',1,8),
  tag:checkedString(b.tag||'新模板','标签',1,30),credits:checkedNum(b.credits??6,'积分',1,100)};
}
async function handleApi(req:Request,env:Env,ctx:Ctx,url:URL):Promise<Response>{
 const path=url.pathname,method=req.method;
 if(method==='GET'&&path==='/api/health')return j({status:'ok',mode:'live',env:'cloudflare',youtube_configured:!!env.YOUTUBE_API_KEY,
  payments_configured:Boolean(billingReady(env)),real_video_configured:env.VIDEO_PROVIDER==='fal'&&!!env.FAL_KEY},200,JSON_HEADERS);
 if(method==='GET'&&path==='/api/public/templates')return j((await all(env,'SELECT * FROM templates WHERE active=1 ORDER BY id')).map(publicTemplate));
 if(method==='GET'&&path.startsWith('/api/public/templates/')){
  const t=await one(env,'SELECT * FROM templates WHERE slug=? AND active=1',decodeURIComponent(path.split('/').at(-1)||''));
  if(!t)fail(404,'模板不存在');return j(publicTemplate(t));
 }
 if(method==='GET'&&path==='/api/public/plans')return j({payment_enabled:Boolean(billingReady(env)),demo_mode:false,items:Object.entries(PACKS).map(([pid,v])=>({id:pid,...v}))});
 // Stripe webhook: signed raw body; never use browser CSRF or trust successful redirects.
 if(method==='POST'&&path==='/api/billing/stripe-webhook'){
  if(!billingReady(env))fail(503,'尚未启用支付');
  const raw=await req.text();if(raw.length>262144)fail(413,'请求体过大');
  const ev=await verifyStripe(raw,req.headers.get('stripe-signature')||'',env.STRIPE_WEBHOOK_SECRET||'');
  return j({ok:true,status:await handleStripeEvent(env,ev)});
 }
 if(method==='POST'&&path==='/api/auth/register'){
  if(env.REGISTRATION_ENABLED==='false')fail(403,'暂未开放注册');
  await throttle(req,env,'register',8);
  const b=await bodyJson(req),email=checkedString(b.email,'邮箱',5,254).toLowerCase(),pw=String(b.password||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||pw.length<10||pw.length>128)fail(422,'请输入有效邮箱和至少 10 位密码');
  if(await one(env,'SELECT id FROM users WHERE email=?',email))fail(409,'邮箱已经注册');
  const hash=await hashPassword(pw);
  await run(env,'INSERT INTO users(email,password_hash) VALUES(?,?)',email,hash);
  const user=await one(env,'SELECT * FROM users WHERE email=?',email);
  return withCookies(userPublic(user),await issueSession(user,env));
 }
 if(method==='POST'&&path==='/api/auth/login'){
  await throttle(req,env,'login',24);
  const b=await bodyJson(req),email=checkedString(b.email,'邮箱',5,254).toLowerCase();
  const user=await one(env,'SELECT * FROM users WHERE email=?',email);
  if(!user||!(await verifyPassword(String(b.password||''),user.password_hash)))fail(401,'邮箱或密码不正确');
  return withCookies(userPublic(user),await issueSession(user,env));
 }
 if(method==='POST'&&path==='/api/events'){
  await throttle(req,env,'events',120);
  const b=await bodyJson(req);const event=String(b.event||'').slice(0,50),source=String(b.source||'direct').slice(0,70);
  if(!['page_view','pricing_view','template_view','studio_view'].includes(event))return j({ok:true});
  const u=await getUser(req,env,false);
  await run(env,'INSERT INTO metric_events(user_id,event,source) VALUES(?,?,?)',u?.id||null,event,source);return j({ok:true});
 }
 if(path==='/api/auth/demo'||path==='/api/billing/demo-topup')fail(404,'线上演示管理员和虚拟充值已关闭');
 const user=await getUser(req,env); // All remaining API endpoints require session.
 if(method==='GET'&&path==='/api/auth/me')return j(userPublic(user));
 if(method==='POST')csrfCheck(req);
 if(method==='PATCH')csrfCheck(req);
 if(method==='DELETE')csrfCheck(req);
 if(method==='POST'&&path==='/api/auth/logout')return withCookies({ok:true},[
  'tm_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
  'tm_csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax']);
 if(method==='GET'&&path==='/api/wallet')return j(await wallet(env,user));
 if(method==='POST'&&path==='/api/billing/checkout')return j(await checkout(env,user,checkedString((await bodyJson(req)).product_id,'商品ID',3,60)));
 if(method==='POST'&&path==='/api/billing/portal')return j(await billingPortal(env,user));
 if(method==='POST'&&path==='/api/jobs')return j(await createJob(req,env,ctx,user),201);
 if(method==='GET'&&path==='/api/jobs'){
  const items=await all(env,`SELECT j.*,t.title AS template_name FROM jobs j JOIN templates t ON t.id=j.template_id WHERE j.user_id=? ORDER BY j.created_at DESC LIMIT 40`,user.id);
  return j(items.map(x=>jobOut(x,x.template_name)));
 }
 const download=match(path,/^\/api\/jobs\/([a-zA-Z0-9-]+)\/download$/);
 if(method==='GET'&&download)return downloadJob(env,user,download[1]);
 const job=match(path,/^\/api\/jobs\/([a-zA-Z0-9-]+)$/);
 if(method==='GET'&&job){const x=await one(env,`SELECT j.*,t.title AS template_name FROM jobs j JOIN templates t ON t.id=j.template_id WHERE j.id=? AND j.user_id=?`,job[1],user.id);if(!x)fail(404,'任务不存在');return j(jobOut(x,x.template_name));}
 // Role-gated intelligence, template factory and analytics endpoints.
 if(!path.startsWith('/api/admin/'))fail(404,'API 不存在');
 if(!user.is_admin)fail(403,'管理员权限不足');
 if(method==='GET'&&path==='/api/admin/templates')return j((await all(env,'SELECT * FROM templates ORDER BY id')).map(t=>({...publicTemplate(t),prompt:t.prompt,active:Boolean(t.active)})));
 if(method==='POST'&&path==='/api/admin/templates'){
  const t=validateTemplate(await bodyJson(req));
  if(await one(env,'SELECT id FROM templates WHERE slug=?',t.slug))fail(409,'URL 标识已存在');
  await run(env,`INSERT INTO templates(slug,title,title_en,description,description_en,prompt,emoji,tag,credits) VALUES(?,?,?,?,?,?,?,?,?)`,
   t.slug,t.title,t.title_en,t.description,t.description_en,t.prompt,t.emoji,t.tag,t.credits);
  return j({...publicTemplate(await one(env,'SELECT * FROM templates WHERE slug=?',t.slug)),active:true},201);
 }
 const templateEdit=match(path,/^\/api\/admin\/templates\/(\d+)$/);
 if(method==='PATCH'&&templateEdit){const k=tid(templateEdit[1]),b=await bodyJson(req);
  const old=await one(env,'SELECT * FROM templates WHERE id=?',k);if(!old)fail(404,'模板不存在');
  const active=b.active===undefined?old.active:(b.active?1:0);
  const credits=b.credits===undefined?old.credits:checkedNum(b.credits,'积分',1,100);
  const prompt=b.prompt===undefined?old.prompt:checkedString(b.prompt,'Prompt',30,2500);
  await run(env,'UPDATE templates SET active=?,credits=?,prompt=? WHERE id=?',active,credits,prompt,k);
  const t=await one(env,'SELECT * FROM templates WHERE id=?',k);return j({...publicTemplate(t),prompt:t.prompt,active:Boolean(t.active)});
 }
 if(method==='GET'&&path==='/api/admin/trends')return j(await listTrends(env));
 if(method==='POST'&&path==='/api/admin/trends')return j(await addTrend(env,await bodyJson(req)),201);
 const trendEdit=match(path,/^\/api\/admin\/trends\/(\d+)$/);
 if(method==='PATCH'&&trendEdit)return j(await updateTrend(env,tid(trendEdit[1]),await bodyJson(req)));
 const evidence=match(path,/^\/api\/admin\/trends\/(\d+)\/evidence$/);
 if(method==='GET'&&evidence)return j(await all(env,'SELECT title,platform,url,views,prev_views,observed_at FROM video_evidence WHERE trend_id=? ORDER BY views DESC LIMIT 25',tid(evidence[1])));
 if(method==='GET'&&path==='/api/admin/discoveries')return j((await all(env,'SELECT * FROM discoveries ORDER BY observed_at DESC LIMIT 80')).map(x=>({...x,promoted:Boolean(x.promoted)})));
 const promote=match(path,/^\/api\/admin\/discoveries\/(\d+)\/promote$/);
 if(method==='POST'&&promote)return j(await promoteDiscovery(env,tid(promote[1])));
 if(method==='POST'&&path==='/api/admin/collect')return j(await collectYoutube(env));
 if(method==='GET'&&path==='/api/admin/report'){
  const report=await reportMarkdown(env);
  return new Response(report,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="trendmint-${now().slice(0,10)}.md"`}});
 }
 if(method==='GET'&&path==='/api/admin/overview'){
  const [u,js,done,active,rev,cost,views,trends,last]=await Promise.all([
    one(env,'SELECT COUNT(*) AS n FROM users'),one(env,'SELECT COUNT(*) AS n FROM jobs'),
    one(env,"SELECT COUNT(*) AS n FROM jobs WHERE status='completed'"),
    one(env,"SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','processing')"),
    one(env,'SELECT COALESCE(SUM(cents),0) AS n FROM revenue_events'),
    one(env,"SELECT COALESCE(SUM(estimated_cost_usd),0) AS n FROM jobs WHERE provider='fal' AND status<>'queued'"),
    one(env,"SELECT COUNT(*) AS n FROM metric_events WHERE event='page_view'"),
    one(env,'SELECT COUNT(*) AS n FROM trends'),
    one(env,'SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 1')]);
  return j({users:u?.n||0,jobs:js?.n||0,completed:done?.n||0,active_jobs:active?.n||0,
    revenue_usd:Math.round((rev?.n||0))/100,cost_estimate_usd:Number(cost?.n||0),
    contribution_estimate_usd:(Number(rev?.n||0)/100-Number(cost?.n||0)),page_views:views?.n||0,
    trends_count:trends?.n||0,last_collection:last?{status:last.status,detail:last.detail,time:last.started_at}:null,
    disclaimer:'收入来自通过签名验证的支付事件，模型费用仍为估算，未扣除手续费、税费、退款及固定成本。'});
 }
 return fail(404,'管理接口不存在');
}
function xmlEsc(s:string){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function serve(req:Request,env:Env,url:URL):Promise<Response>{
 const path=url.pathname,base=(env.WEB_BASE_URL||url.origin).replace(/\/$/,'');
 if(path==='/robots.txt')return new Response(`User-agent: *\nAllow: /t/\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /settings\nSitemap: ${base}/sitemap.xml\n`,{headers:{'Content-Type':'text/plain'}});
 if(path==='/sitemap.xml'){
  const slugs=await all(env,'SELECT slug FROM templates WHERE active=1');
  const urls=[base+'/',...slugs.map(x=>base+'/t/'+x.slug)];
  return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(x=>`<url><loc>${xmlEsc(x)}</loc></url>`).join('')+'</urlset>',{headers:{'Content-Type':'application/xml'}});
 }
 if(path.startsWith('/static/'))return env.ASSETS.fetch(req);
 if(!['/','/dashboard','/trends','/studio','/jobs','/billing','/settings','/login'].includes(path)&&!/^\/t\/[a-z0-9-]+$/.test(path))return new Response('Page not found',{status:404});
 let title='TrendMint — AI Video Trend Studio',description='Turn your photos into original AI videos with easy-to-use templates.',canonical=base+'/',robots='noindex,nofollow';
 if(path==='/')robots='index,follow';
 if(path.startsWith('/t/')){
  const t=await one(env,'SELECT title_en,description_en FROM templates WHERE slug=? AND active=1',path.slice(3));
  if(t){title=t.title_en+' | TrendMint';description=t.description_en;canonical=base+path;robots='index,follow';}
 }
 const original=await env.ASSETS.fetch(new Request('https://assets.local/index.html'));
 if(!original.ok)fail(500,'找不到首页静态资源');
 let html=await original.text();
 for(const [k,v] of Object.entries({TITLE:title,DESCRIPTION:description,CANONICAL:canonical,ROBOTS:robots}))html=html.replaceAll(`%%PAGE_${k}%%`,xmlEsc(v));
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
}
const worker={
 async fetch(req:Request,env:Env,ctx:Ctx):Promise<Response>{
  try{
   if(!env.DB)fail(503,'Cloudflare D1 数据库未绑定');
   const url=new URL(req.url);let response:Response;
   if(url.pathname.startsWith('/api/'))response=await handleApi(req,env,ctx,url);
   else if(req.method==='GET'||req.method==='HEAD')response=await serve(req,env,url);
   else return fail(405,'Method not allowed');
   return security(response);
  }catch(e){if(e instanceof ApiError)return security(j({detail:e.message},e.status,JSON_HEADERS));
    console.error('Worker error',String(e));return security(j({detail:'服务暂时不可用，请稍后重试'},500,JSON_HEADERS));}
 },
 async scheduled(event:{cron:string},env:Env,ctx:Ctx){
  ctx.waitUntil((async()=>{
   if(event.cron==='0 3 * * *'){
    await cleanup(env);if(env.YOUTUBE_API_KEY)await collectYoutube(env);
   }else await pollJobs(env);
  })().catch(e=>console.error('scheduled error',String(e))));
 }
};
export default worker;
