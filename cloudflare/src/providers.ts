import {Env} from './core';

// Initial Wan flow: one 5-second, 720P first-frame video; silent by default.
export const WAN_MODEL='wan2.6-i2v-flash';
const REGIONS=new Set(['cn-beijing','ap-southeast-1']); // Flash is offered in these regions.
const TASK_ID=/^[a-z0-9-]{1,128}$/i;
export class ProviderFailure extends Error {}
function workspaceBase(env:Env){
 const workspace=env.DASHSCOPE_WORKSPACE_ID||'',region=env.DASHSCOPE_REGION||'cn-beijing';
 if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(workspace)||!REGIONS.has(region))throw Error('百炼业务空间 ID 或地域配置无效');
 return `https://${workspace}.${region}.maas.aliyuncs.com/api/v1`;
}
function falModel(env:Env){
 const model=env.FAL_MODEL_ID||'fal-ai/kling-video/v2.5-turbo/standard/image-to-video';
 if(!/^[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(model))throw Error('模型标识无效');
 return model;
}
function wanAudio(env:Env){
 const value=env.WAN_AUDIO||'false';
 if(!['true','false'].includes(value))throw Error('WAN_AUDIO 必须为 true 或 false');
 return value==='true';
}
export function videoReady(env:Env,provider=env.VIDEO_PROVIDER){
 if(!env.MEDIA)return false;
 try{
  if(provider==='dashscope'){workspaceBase(env);wanAudio(env);return Boolean(env.DASHSCOPE_API_KEY);}
  if(provider==='fal'){falModel(env);return Boolean(env.FAL_KEY);}
 }catch{return false;}
 return false;
}
function httpsUrl(raw:string):URL|null{
 try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u:null;}catch{return null;}
}
function falQueue(raw:string){return httpsUrl(raw)?.hostname==='queue.fal.run';}
export function trustedVideoUrl(raw:string,provider:string){
 const u=httpsUrl(raw);if(!u)return false;
 if(provider==='fal')return u.hostname==='fal.media'||u.hostname.endsWith('.fal.media');
 return provider==='dashscope'&&/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname);
}
export function imageDataUrl(bytes:Uint8Array,type:string){
 let s='';for(let i=0;i<bytes.length;i+=0x4000)s+=String.fromCharCode(...bytes.subarray(i,i+0x4000));
 return `data:${type};base64,${btoa(s)}`; // RFC 4648 standard Base64, including padding.
}
function errorCode(data:any){const code=data?.output?.code||data?.code;return typeof code==='string'&&/^[a-z0-9_.-]{1,80}$/i.test(code)?` (${code})`:'';}
const auth=(env:Env,provider:string)=>({Authorization:provider==='dashscope'?`Bearer ${env.DASHSCOPE_API_KEY}`:`Key ${env.FAL_KEY}`});
const options={redirect:'error' as const}; // Never forward provider credentials through redirects.
export async function submitVideo(env:Env,provider:string,image:string,prompt:string){
 if(!videoReady(env,provider))throw new ProviderFailure('视频提供商配置不完整');
 if(provider==='dashscope'){
  if(prompt.length>1500)throw new ProviderFailure('万相提示词超过 1500 字符，请缩短模板或附加提示词');
  const base=workspaceBase(env);
  const res=await fetch(`${base}/services/aigc/video-generation/video-synthesis`,{...options,method:'POST',signal:AbortSignal.timeout(25000),
   headers:{...auth(env,provider),'Content-Type':'application/json','X-DashScope-Async':'enable'},
   body:JSON.stringify({model:WAN_MODEL,input:{prompt,img_url:image},
    parameters:{resolution:'720P',duration:5,audio:wanAudio(env),prompt_extend:true,shot_type:'single'}})});
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok||data.code)throw new ProviderFailure(`百炼提交失败 HTTP ${res.status}${errorCode(data)}`);
  const task=data?.output?.task_id;
  if(typeof task!=='string'||!TASK_ID.test(task))throw new ProviderFailure('百炼未返回有效任务 ID');
  if(['FAILED','CANCELED','UNKNOWN'].includes(data?.output?.task_status))throw new ProviderFailure(`模型处理失败${errorCode(data)}`);
  const url=`${base}/tasks/${task}`;
  return {id:task,statusUrl:url,responseUrl:url};
 }
 const res=await fetch(`https://queue.fal.run/${falModel(env)}`,{...options,method:'POST',signal:AbortSignal.timeout(25000),
  headers:{...auth(env,provider),'Content-Type':'application/json'},body:JSON.stringify({image_url:image,prompt})});
 if(!res.ok)throw new ProviderFailure(`模型提交失败 HTTP ${res.status}`);
 const data:any=await res.json();
 if(typeof data.request_id!=='string'||!TASK_ID.test(data.request_id)||!falQueue(data.status_url)||!falQueue(data.response_url))throw new ProviderFailure('模型未返回有效任务信息');
 return {id:data.request_id,statusUrl:data.status_url,responseUrl:data.response_url};
}
export function validProviderTask(env:Env,job:any){
 if(!TASK_ID.test(job.provider_request_id||''))return false;
 if(job.provider==='dashscope'){
  try{return job.provider_status_url===`${workspaceBase(env)}/tasks/${job.provider_request_id}`;}catch{return false;}
 }
 return job.provider==='fal'&&falQueue(job.provider_status_url)&&falQueue(job.provider_response_url);
}
export async function pollVideo(env:Env,job:any):Promise<string|null>{
 if(!validProviderTask(env,job))throw new ProviderFailure('模型任务地址无效');
 const res=await fetch(job.provider_status_url,{...options,signal:AbortSignal.timeout(15000),headers:auth(env,job.provider)});
 if(!res.ok)throw Error(`模型状态请求失败 HTTP ${res.status}`);
 const state:any=await res.json();let videoUrl:any;
 if(job.provider==='dashscope'){
  const status=state?.output?.task_status;
  if(['FAILED','CANCELED','UNKNOWN'].includes(status))throw new ProviderFailure(`模型处理失败：${status}${errorCode(state)}`);
  if(state.code)throw Error(`百炼查询错误${errorCode(state)}`);
  if(status!=='SUCCEEDED')return null;
  videoUrl=state.output.video_url;
 }else{
  if(state.error||state.status==='FAILED')throw new ProviderFailure('模型处理失败');
  if(state.status!=='COMPLETED')return null;
  const result=await fetch(job.provider_response_url,{...options,signal:AbortSignal.timeout(15000),headers:auth(env,job.provider)});
  if(!result.ok)throw Error(`结果获取失败 HTTP ${result.status}`);
  const data:any=await result.json();videoUrl=data?.video?.url;
 }
 if(typeof videoUrl!=='string'||!trustedVideoUrl(videoUrl,job.provider))throw new ProviderFailure('视频地址不是受信任的提供商域名');
 return videoUrl;
}
