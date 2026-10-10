import {Env,all,one,run,now,fail,checkedNum,checkedString,safeUrl} from './core';
export function trendScore(t:any):number{
 const growth=t.growth_pct==null?0:(t.growth_pct<1?1:t.growth_pct<5?2:t.growth_pct<20?3:t.growth_pct<100?4:5);
 return Math.round(25*growth/5+25*Number(t.demand||3)/5+20*Number(t.willingness||3)/5+15*Number(t.opportunity||3)/5+15*((Number(t.feasibility||3)+Number(t.compliance||3))/2)/5);
}
export const trendOutput=(t:any)=>({...t,is_sample:Boolean(t.is_sample),score:Number(t.score||0)});
export async function listTrends(env:Env){return (await all(env,'SELECT * FROM trends ORDER BY score DESC,id DESC LIMIT 100')).map(trendOutput)}
export async function addTrend(env:Env,body:any){
 const title=checkedString(body.title,'名称',3,160),keyword=checkedString(body.keyword,'关键词',3,160);
 const source_url=String(body.source_url||'');if(source_url&&!safeUrl(source_url))fail(422,'线索来源必须是 HTTPS 链接');
 const notes=String(body.notes||'').slice(0,1000);
 if(await one(env,'SELECT id FROM trends WHERE keyword=?',keyword))fail(409,'此关键词已经存在');
 const t={growth_pct:null,demand:3,willingness:3,opportunity:3,feasibility:3,compliance:3};
 await run(env,`INSERT INTO trends(title,keyword,source_url,notes,score) VALUES(?,?,?,?,?)`,title,keyword,source_url,notes,trendScore(t));
 return trendOutput(await one(env,'SELECT * FROM trends WHERE keyword=?',keyword));
}
export async function updateTrend(env:Env,tid:number,b:any){
 const t=await one(env,'SELECT * FROM trends WHERE id=?',tid);if(!t)fail(404,'趋势不存在');
 for(const k of ['demand','willingness','opportunity','feasibility','compliance'])t[k]=checkedNum(b[k]??t[k],k,1,5);
 if(b.stage!==undefined){if(!['待验证','测试中','已上线','暂缓'].includes(b.stage))fail(422,'阶段无效');t.stage=b.stage;}
 t.notes=String(b.notes??t.notes).slice(0,1000);t.score=trendScore(t);
 await run(env,`UPDATE trends SET demand=?,willingness=?,opportunity=?,feasibility=?,compliance=?,stage=?,notes=?,score=? WHERE id=?`,t.demand,t.willingness,t.opportunity,t.feasibility,t.compliance,t.stage,t.notes,t.score,tid);
 return trendOutput(await one(env,'SELECT * FROM trends WHERE id=?',tid));
}
async function youtube(path:string,params:Record<string,string>,key:string):Promise<any>{
 const url=new URL('https://www.googleapis.com/youtube/v3/'+path);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('key',key);
 const r=await fetch(url,{headers:{'Accept':'application/json'}});
 if(!r.ok)throw new Error(`YouTube ${path} HTTP ${r.status}`);
 return r.json();
}
const broadQueries=['AI video trend shorts','AI filter trend tutorial'];
export async function collectYoutube(env:Env){
 if(!env.YOUTUBE_API_KEY)return fail(503,'YouTube API Key 尚未配置');
 const key=env.YOUTUBE_API_KEY;
 const started=now();const runRes=await run(env,"INSERT INTO collection_runs(source,status) VALUES('youtube','running')");
 const rid=runRes.meta?.last_row_id;let tracked=0,discoveries=0;const errors:string[]=[];
 const trackedRows=await all(env,'SELECT id,keyword FROM trends WHERE is_sample=0 ORDER BY id DESC LIMIT 8');
 const searches=[...trackedRows.map(x=>({id:x.id,q:x.keyword})),...broadQueries.map(q=>({id:null,q}))];
 for(const s of searches){
  try{
   const list=await youtube('search',{part:'snippet',maxResults:'12',type:'video',order:'date',publishedAfter:new Date(Date.now()-7*86400000).toISOString(),q:s.q},key);
   const videoItems=(list.items||[]).filter((x:any)=>x.id?.videoId);
   if(!videoItems.length)continue;
   const vids=await youtube('videos',{part:'snippet,statistics',id:videoItems.map((x:any)=>x.id.videoId).join(',')},key);
   for(const v of vids.items||[]){
    const vid=String(v.id),views=Number(v.statistics?.viewCount||0),title=String(v.snippet?.title||'').slice(0,250);
    const url=`https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`;
    if(s.id){
     const old=await one(env,'SELECT * FROM video_evidence WHERE trend_id=? AND platform=? AND external_id=?',s.id,'youtube',vid);
     const canUpdate=old&&Date.now()-Date.parse(old.observed_at)>4*3600000;
     if(!old){await run(env,`INSERT INTO video_evidence(trend_id,platform,external_id,title,url,views,observed_at) VALUES(?,'youtube',?,?,?,?,?)`,s.id,vid,title,url,views,now());}
     else if(canUpdate){await run(env,`UPDATE video_evidence SET title=?,views=?,prev_views=?,prev_at=?,observed_at=? WHERE id=?`,title,views,old.views,old.observed_at,now(),old.id);}
    }else{
     const published=v.snippet?.publishedAt||null;const age=published?Math.max(0.2,(Date.now()-Date.parse(published))/3600000):null;
     await run(env,`INSERT INTO discoveries(external_id,title,url,views,published_at,observed_at,velocity_per_hour,video_age_hours)
       VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET title=excluded.title,views=excluded.views,observed_at=excluded.observed_at,velocity_per_hour=excluded.velocity_per_hour,video_age_hours=excluded.video_age_hours`,vid,title,url,views,published,now(),age?Math.round(views/age):null,age);
     discoveries++;
    }
   }
   if(s.id){
    tracked++;
    const rows=await all(env,'SELECT views,prev_views FROM video_evidence WHERE trend_id=?',s.id);
    const total=rows.reduce((n:number,r:any)=>n+Number(r.views||0),0);
    const compared=rows.filter((r:any)=>r.prev_views!=null);
    const delta=compared.length?compared.reduce((n:number,r:any)=>n+Number(r.views||0)-Number(r.prev_views||0),0):null;
    const prev=compared.reduce((n:number,r:any)=>n+Number(r.prev_views||0),0);
    const growth=delta!==null&&prev>0?Math.round(10000*delta/prev)/100:null;
    const t=await one(env,'SELECT * FROM trends WHERE id=?',s.id);
    await run(env,`UPDATE trends SET sample_count=?,sample_views=?,delta_views=?,growth_pct=?,measured_at=?,score=? WHERE id=?`,rows.length,total,delta,growth,now(),trendScore({...t,growth_pct:growth}),s.id);
   }
  }catch(e){errors.push(`${s.q}: ${String(e).slice(0,85)}`)}
 }
 const details=`跟踪 ${tracked} 个候选，发现 ${discoveries} 个视频样本；错误 ${errors.length}`;
 await run(env,'UPDATE collection_runs SET status=?,detail=?,finished_at=? WHERE id=?',errors.length?'partial':'completed',details,now(),rid);
 return {tracked,discoveries,errors,started_at:started};
}
export async function promoteDiscovery(env:Env,discoveryId:number){
 const d=await one(env,'SELECT * FROM discoveries WHERE id=?',discoveryId);if(!d)fail(404,'线索不存在');
 if(d.promoted)fail(409,'已经添加候选');
 const keyword=String(d.title).slice(0,145);
 if(await one(env,'SELECT id FROM trends WHERE keyword=?',keyword))fail(409,'候选词重复');
 await run(env,`INSERT INTO trends(title,keyword,source,source_url,notes,score) VALUES(?,?,'youtube',?,?,?)`,d.title.slice(0,160),keyword,d.url,'YouTube 自动发现的候选，尚需人工验证真实需求。',trendScore({}));
 await run(env,'UPDATE discoveries SET promoted=1 WHERE id=?',discoveryId);
 return trendOutput(await one(env,'SELECT * FROM trends WHERE keyword=?',keyword));
}
export async function reportMarkdown(env:Env){
 const ts=await listTrends(env);return `# TrendMint AI 趋势日报 · ${now().slice(0,10)}\n\n> 播放量仅来自采样视频，不等于全网热度；评分有人工判断。\n\n`+
 ts.map((t:any,i:number)=>`${i+1}. **${t.title}** — ${t.score}/100\n   - 关键词：${t.keyword}\n   - 阶段：${t.stage} · 来源：${t.source}${t.is_sample?'（演示样例）':''}\n   - 采样播放：${t.sample_views??'无'} · 重复采样变化：${t.growth_pct??'未知'}%\n   - 备注：${t.notes||'无'}\n`).join('\n');
}
