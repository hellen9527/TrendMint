import {Env,Ctx,all,one,run,now,id,fail,moveCredits,checkedNum} from './core';
import {videoReady,submitVideo,pollVideo,validProviderTask,imageDataUrl,ProviderFailure} from './providers';
const MAX=4*1024*1024;
function imageType(bytes:Uint8Array){
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return 'image/png';
 if(bytes.length>=12&&new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP')return 'image/webp';
 fail(422,'文件格式不是有效的 JPEG、PNG 或 WebP');
}
export function jobOut(job:any,templateName=''){
 return {...job,template_name:templateName,download_url:job.status==='completed'&&job.output_key?`/api/jobs/${job.id}/download`:null};
}
export async function createJob(req:Request,env:Env,ctx:Ctx,user:any){
 if(!videoReady(env))fail(503,'视频模型尚未启用，请检查服务端 Key、业务空间和地域配置');
 const provider=env.VIDEO_PROVIDER!;
 const form=await req.formData();
 if(String(form.get('agree_rights')).toLowerCase()!=='true')fail(422,'请确认上传图片和肖像使用权');
 const templateId=checkedNum(form.get('template_id'),'模板 ID',1,10000000);
 const prompt=String(form.get('custom_prompt')||'').trim();if(prompt.length>300)fail(422,'附加提示词过长');
 const t=await one(env,'SELECT * FROM templates WHERE id=? AND active=1',templateId);if(!t)fail(404,'模板不存在');
 const f=form.get('image');if(!(f instanceof File))return fail(422,'需要上传一张图片');
 if(f.size>MAX||f.size<25)fail(413,'图片大小必须在 25B 至 4MB 之间');
 const buffer=await f.arrayBuffer(),type=imageType(new Uint8Array(buffer));
 if((await one(env,"SELECT COUNT(*) AS n FROM jobs WHERE user_id=? AND datetime(created_at)>=datetime(?)",user.id,new Date(Date.now()-86400000).toISOString()))?.n>=25)fail(429,'今日任务已达到限额');
 const defaultCost=provider==='dashscope'?(env.DASHSCOPE_REGION==='ap-southeast-1'?(env.WAN_AUDIO==='true'?0.28:0.14):(env.WAN_AUDIO==='true'?0.24:0.12)):0.5;
 const cost=Number(env.VIDEO_COST_ESTIMATE_USD||defaultCost),limit=Number(env.MAX_DAILY_VIDEO_BUDGET_USD||5);
 if(!Number.isFinite(cost)||!Number.isFinite(limit)||!(cost>0&&limit>0))fail(503,'模型预算未正确配置');
 const jid=id(),key=`inputs/${jid}`;
 await env.MEDIA.put(key,buffer,{httpMetadata:{contentType:type}});
 let reserved=false;
 try{
  const ok=await moveCredits(env,user.id,-Number(t.credits),'预扣生成积分',`job:${jid}:reserve`);
  if(!ok)fail(402,'积分不足，请先充值');
  reserved=true;
  // A single INSERT guards the shared daily budget, including queued reservations.
  // Count failed jobs conservatively: a provider may have billed an uncertain submission.
  const inserted=await run(env,`INSERT INTO jobs(id,user_id,template_id,status,input_key,custom_prompt,cost_credits,estimated_cost_usd,provider)
   SELECT ?,?,?,'queued',?,?,?,?,? WHERE
   (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM jobs WHERE provider IN ('fal','dashscope') AND datetime(created_at)>=datetime('now','start of day'))+?<=?`,
   jid,user.id,t.id,key,prompt,t.credits,cost,provider,cost,limit);
  if(Number(inserted.meta?.changes||0)!==1)fail(429,'今日生成预算已用完');
 }catch(e){
  if(reserved)await moveCredits(env,user.id,Number(t.credits),'任务无法创建返还积分',`job:${jid}:create-failed-refund`);
  await env.MEDIA.delete(key).catch(()=>{});throw e;
 }
 ctx.waitUntil(startQueued(env,jid));
 return jobOut(await one(env,'SELECT * FROM jobs WHERE id=?',jid),t.title);
}
async function failure(env:Env,job:any,reason:string){
 const msg=String(reason).slice(0,270);
 await run(env,"UPDATE jobs SET status='failed',error=?,completed_at=? WHERE id=? AND status NOT IN ('completed','failed')",msg,now(),job.id);
 // Do not refund if another worker has already completed this job.
 const recent=await one(env,'SELECT status FROM jobs WHERE id=?',job.id);
 if(recent?.status==='failed')await moveCredits(env,job.user_id,job.cost_credits,'视频生成失败返还积分',`job:${job.id}:refund`);
 if(job.input_key)await env.MEDIA.delete(job.input_key).catch(()=>{});
}
export async function startQueued(env:Env,jid:string){
 const job=await one(env,'SELECT * FROM jobs WHERE id=?',jid);if(!job||job.status!=='queued'||!videoReady(env,job.provider))return;
 const locked=await run(env,"UPDATE jobs SET status='processing',started_at=? WHERE id=? AND status='queued'",now(),jid);
 if(Number(locked.meta?.changes||0)!==1)return;
 try{
  const obj=await env.MEDIA.get(job.input_key);if(!obj)throw Error('上传图片丢失');
  const bytes=new Uint8Array(await obj.arrayBuffer());
  const image=imageDataUrl(bytes,obj.httpMetadata?.contentType||'image/jpeg');
  const template=await one(env,'SELECT * FROM templates WHERE id=?',job.template_id);
  if(!template)throw Error('模板不存在');
  const task=await submitVideo(env,job.provider,image,template.prompt+(job.custom_prompt?` Additional direction: ${job.custom_prompt}`:''));
  await run(env,'UPDATE jobs SET provider_request_id=?,provider_status_url=?,provider_response_url=? WHERE id=?',task.id,task.statusUrl,task.responseUrl,jid);
 }catch(e){console.error('video submit failed',job.provider,job.id);await failure(env,job,e instanceof ProviderFailure?e.message:'模型提交未确认成功，请检查服务端日志后重试');}
}
async function checkJob(env:Env,job:any){
 if(!validProviderTask(env,job)){
  // If crashed immediately after claim, allow at most 20 minutes for recovery.
  if(Date.now()-Date.parse(job.started_at||job.created_at)>20*60000)await failure(env,job,'提交模型超时，请重试');return;
 }
 try{
  const videoUrl=await pollVideo(env,job);if(!videoUrl)return;
  const videoResponse=await fetch(videoUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!videoResponse.ok)throw Error(`下载视频失败 HTTP ${videoResponse.status}`);
  if(Number(videoResponse.headers.get('Content-Length')||0)>50*1024*1024)throw new ProviderFailure('视频超过 50MB');
  const media=await videoResponse.arrayBuffer();if(media.byteLength<1024||media.byteLength>50*1024*1024)throw new ProviderFailure('视频文件大小异常');
  const output=`outputs/${job.id}.mp4`;
  await env.MEDIA.put(output,media,{httpMetadata:{contentType:'video/mp4'}});
  await run(env,"UPDATE jobs SET status='completed',output_key=?,completed_at=?,error=NULL WHERE id=? AND status='processing'",output,now(),job.id);
  if(job.input_key)await env.MEDIA.delete(job.input_key);
 }catch(e){console.error('video polling failed',job.provider,job.id);
  // Polling errors may be temporary. Only hard model errors should settle as failed.
  if(e instanceof ProviderFailure)await failure(env,job,e.message);
 }
}
export async function pollJobs(env:Env){
 const queue=await all(env,"SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 3");
 for(const x of queue)await startQueued(env,x.id);
 const jobs=await all(env,"SELECT * FROM jobs WHERE status='processing' ORDER BY started_at LIMIT 10");
 for(const job of jobs){
  if(!videoReady(env,job.provider))continue;
  if(Date.now()-Date.parse(job.started_at||job.created_at)>3*3600000){await failure(env,job,'模型处理超过 3 小时，任务自动终止');continue;}
  await checkJob(env,job);
 }
}
export async function cleanup(env:Env){
 const cutoff=new Date(Date.now()-7*86400000).toISOString();
 const jobs=await all(env,'SELECT * FROM jobs WHERE completed_at IS NOT NULL AND completed_at<? AND (input_key IS NOT NULL OR output_key IS NOT NULL) LIMIT 150',cutoff);
 for(const job of jobs){if(job.input_key)await env.MEDIA.delete(job.input_key).catch(()=>{});if(job.output_key)await env.MEDIA.delete(job.output_key).catch(()=>{});
  await run(env,'UPDATE jobs SET input_key=NULL,output_key=NULL WHERE id=?',job.id);
 }
 await run(env,'DELETE FROM rate_limits WHERE window_start<?',Math.floor(Date.now()/600000)-72);
}
export async function downloadJob(env:Env,user:any,jobId:string){
 const job=await one(env,'SELECT * FROM jobs WHERE id=? AND user_id=?',jobId,user.id);
 if(!job||job.status!=='completed'||!job.output_key)fail(404,'视频不存在或已过期');
 if(Date.now()-Date.parse(job.completed_at||job.created_at)>7*86400000)fail(410,'视频已过保存期限');
 const obj=await env.MEDIA.get(job.output_key);if(!obj)fail(410,'视频文件已过期');
 return new Response(obj.body,{headers:{'Content-Type':'video/mp4','Content-Disposition':`attachment; filename="trendmint-${jobId.slice(0,8)}.mp4"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}

