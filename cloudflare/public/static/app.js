/* TrendMint — dependency-free progressive SPA. Every displayed metric comes from the API.
 * Sample trend records are conspicuously labeled; generated preview videos are not AI.
 */
(() => {
  'use strict';
  const $ = (q, root=document) => root.querySelector(q);
  const $$ = (q, root=document) => Array.from(root.querySelectorAll(q));
  const esc = (v='') => String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = n => Number(n||0).toLocaleString('zh-CN');
  const dollar = n => '$'+Number(n||0).toFixed(2);
  const dt = x => x ? new Date(x).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const displayCompact = n => n == null ? '未采集' : n>=1000000?(n/1e6).toFixed(1)+'M': n>=1000?(n/1000).toFixed(1)+'K':num(n);
  const iconPaths={
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><path d="m17 6 3-1-1 3"/>',
    spark:'<path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3z"/><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17z"/>',
    video:'<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M16 15h2M6 5V3h12"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M9.4 3h5.2l.6 2.2 2 1.2 2.2-.8L22 10l-1.6 1.6v1.8L22 15l-2.6 4.4-2.2-.8-2 1.2-.6 2.2H9.4l-.6-2.2-2-1.2-2.2.8L2 15l1.6-1.6v-1.8L2 10l2.6-4.4 2.2.8 2-1.2z"/>',
    search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
    arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
    users:'<circle cx="9" cy="8" r="4"/><path d="M1 21v-3a8 8 0 0 1 16 0v3M17 4a4 4 0 0 1 0 8m1 5a6 6 0 0 1 5 4"/>',
    chart:'<path d="M3 20h18M4 14l5-5 4 3 7-8"/><path d="M16 4h4v4"/>',
    upload:'<path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    download:'<path d="M12 4v13m-5-5 5 5 5-5M4 19v2h16v-2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    refresh:'<path d="M20 7V3l-4 4M4 17v4l4-4"/><path d="M5 9a8 8 0 0 1 13-3l2 1M4 17l2 1a8 8 0 0 0 13-3"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
    external:'<path d="M12 5h7v7m0-7-9 9"/><path d="M19 15v4H5V5h5"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    close:'<path d="M5 5l14 14M19 5 5 19"/>',
    logout:'<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9"/>',
    chevron:'<path d="m8 10 4 4 4-4"/>',
    play:'<path d="m7 5 12 7-12 7z"/>',
    cloud:'<path d="M20 17a4 4 0 0 0-1.5-7.7A6.5 6.5 0 0 0 6 10a4 4 0 0 0 1 8h12"/>',
  };
  const ic=(name,cls='')=>`<svg class="svgicon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]||iconPaths.spark}</svg>`;
  const S={user:null,templates:[],jobs:[],wallet:null,overview:null,adminTemplates:[],trends:[],discoveries:[],health:null,plans:[],selected:null,uploadFile:null,preview:null,modal:null,formMode:'login',busy:false,navOpen:false};
  const route=()=>decodeURIComponent(location.pathname);
  const csrf=()=>document.cookie.split('; ').find(x=>x.startsWith('tm_csrf='))?.split('=')[1]||'';

  async function request(path, opts={}){
    const headers=new Headers(opts.headers||{});
    if(opts.body && !(opts.body instanceof FormData) && typeof opts.body==='object'){
      headers.set('Content-Type','application/json');opts.body=JSON.stringify(opts.body);
    }
    if(opts.method && !['GET','HEAD'].includes(opts.method.toUpperCase()))headers.set('X-CSRF-Token',decodeURIComponent(csrf()));
    let res;
    try {res=await fetch('/api'+path,{...opts,headers,credentials:'same-origin'});}
    catch(e){throw Error('网络请求失败：请确认后端正在运行');}
    const result=await res.json().catch(()=>({}));
    if(!res.ok){
      let msg=result.detail||('请求失败：HTTP '+res.status);
      if(Array.isArray(msg))msg=msg.map(x=>x.msg).join('；');
      throw Error(String(msg));
    }
    return result;
  }
  function toast(message,error=false){
    const stack=$('#toast-stack');const el=document.createElement('div');el.className='toast'+(error?' error':'');
    el.innerHTML=`<span class="toast-ico">${ic(error?'info':'check')}</span><span>${esc(message)}</span>`;
    stack.append(el);setTimeout(()=>el.remove(),4800);
  }
  async function safe(fn){if(S.busy)return;S.busy=true;try{await fn();}catch(e){toast(e.message||String(e),true);}finally{S.busy=false;}}
  function navigate(path){if(route()!==path)history.pushState({},'',path);S.modal=null;S.navOpen=false;render();loadRoute();recordEvent(path==='/billing'?'pricing_view':path.startsWith('/t/')?'template_view':'page_view');window.scrollTo({top:0,behavior:'smooth'});}
  function recordEvent(event){request('/events',{method:'POST',body:{event,source:new URLSearchParams(location.search).get('utm_source')||'direct'}}).catch(()=>{});}
  async function init(){
    try{const [t,h,p]=await Promise.all([request('/public/templates'),request('/health'),request('/public/plans')]);S.templates=t;S.health=h;S.plans=p.items||[];}
    catch(e){$('#app').innerHTML=`<div class="initial-loader"><span style="font-size:40px">⚠</span><h3>服务启动失败</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">刷新重试</button></div>`;return;}
    try{S.user=await request('/auth/me');}catch(_){S.user=null;}
    if(S.user && (route()==='/' || route()==='/login'))history.replaceState({},'', '/dashboard');
    render();loadRoute();recordEvent('page_view');
    setInterval(()=>{if(S.user&&(route()==='/jobs'||route()==='/studio')&&!S.busy)loadJobs(true)},4800);
    window.addEventListener('popstate',()=>{S.modal=null;render();loadRoute();});
  }
  async function loadRoute(){
    if(!S.user)return;
    const path=route();
    const actions=[];
    if(path==='/dashboard' && S.user.is_admin)actions.push(request('/admin/overview').then(x=>S.overview=x));
    if((path==='/trends'||path==='/dashboard')&&S.user.is_admin)actions.push(request('/admin/trends').then(x=>S.trends=x));
    if(path==='/trends'&&S.user.is_admin)actions.push(request('/admin/discoveries').then(x=>S.discoveries=x));
    if(path==='/billing')actions.push(request('/wallet').then(x=>S.wallet=x));
    if(path==='/settings'&&S.user.is_admin)actions.push(request('/admin/templates').then(x=>S.adminTemplates=x));
    if(path==='/jobs'||path==='/dashboard'||path==='/studio')actions.push(request('/jobs').then(x=>S.jobs=x));
    try{await Promise.all(actions);render();}catch(e){toast(e.message,true);}
  }
  async function loadJobs(silent=false){
    try{const jobs=await request('/jobs');if(JSON.stringify(jobs)!==JSON.stringify(S.jobs)){S.jobs=jobs;render();if(!silent)toast('任务已更新');}}
    catch(e){if(!silent)toast(e.message,true);}
  }
  function templateArt(t,big=false){let cls={'pet-popstar':'art-pet','memory-alive':'art-memory','birthday-magic':'art-birthday','mini-adventure':'art-mini'}[t.slug]||'art-mini';return `<div class="template-art ${cls}"><span class="template-tag">${esc(t.tag)}</span><span class="big-emoji" aria-hidden="true">${esc(t.emoji)}</span></div>`;}
  function templateCard(t){return `<article class="panel template-card" data-action="open-template" data-slug="${esc(t.slug)}">${templateArt(t)}<div class="template-card-body"><h3>${esc(t.title)}</h3><p>${esc(t.description)}</p><div class="template-footer"><span>${ic('bolt','sm')} ${t.credits} 积分 / 次</span><strong>开始制作 →</strong></div></div></article>`;}
  function brand(){return `<a href="/" data-nav="/" class="brand"><span class="brand-mark">✦</span><span>TrendMint<span class="brand-sub">TREND TO PRODUCT</span></span></a>`;}
  function navLink(path,label,ico,count=''){return `<button class="side-link ${route()===path?'active':''}" data-nav="${path}">${ic(ico)}<span>${label}</span>${count?`<span class="nav-count">${count}</span>`:''}</button>`;}
  function shell(content,title,desc){
    const isAdmin=Boolean(S.user?.is_admin);
    return `<div class="app-layout"><aside class="sidebar ${S.navOpen?'show':''}">${brand()}<div class="sidebar-section">WORKSPACE / 工作区</div>
    ${navLink('/dashboard','总览控制台','grid')}
    ${isAdmin?navLink('/trends','热点雷达','radar','LIVE'):''}
    ${navLink('/studio','AI 创作工坊','spark')}
    ${navLink('/jobs','我的生成任务','video')}
    <div class="sidebar-section">ACCOUNT / 账户</div>
    ${navLink('/billing','积分与支付','wallet')}
    ${navLink('/settings','系统与配置','settings')}
    <div class="sidebar-fill"></div>
    <div class="sidebar-note"><div class="mini-star">✦</div><h4>下一款爆款，正在出现。</h4><p>找到上升中的玩法，再把它变成一个可收费的一键工具。</p><button data-nav="${isAdmin?'/trends':'/studio'}">${isAdmin?'开始挖掘热点':'探索创意模板'} →</button></div>
    <div class="side-footer"><span class="online-dot"></span><span>${S.health?.mode==='demo'?'演示运行中 · 非真实 AI':'真实生成模式已配置'}</span></div></aside>
    <main class="main"><header class="topbar"><button class="btn btn-ghost mobile-toggle" data-action="mobile-open">${ic('menu')}</button><div><div class="top-title">${esc(title)}</div><div class="top-desc">${esc(desc)}</div></div><div class="top-spacer"></div><button class="search-chip" data-nav="/trends">${ic('search','sm')} 发现新的 AI 视频玩法 <kbd>⌘ /</kbd></button>
    <button class="credits-pill" data-nav="/billing">${ic('bolt','sm')} <span>${num(S.user?.credits)}</span> 积分</button><button class="avatar top-avatar" data-action="logout" title="退出登录">${esc((S.user?.email||'U').slice(0,1).toUpperCase())}</button></header><div class="workspace">${content}</div></main></div>${S.navOpen?'<div class="modal-backdrop" data-action="mobile-close" style="background:#0007;z-index:15"></div>':''}`;
  }
  function pageHead(kicker,title,subtitle,buttons=''){return `<div class="page-head"><div><div class="eyebrow"><span class="dot"></span>${esc(kicker)}</div><h1 class="page-h1">${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="header-actions">${buttons}</div></div>`;}
  function metric(label,value,note,ico,style=''){return `<div class="panel stat"><div class="stat-top"><span>${label}</span><span class="stat-icon ${style}">${ic(ico)}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-note">${note}</div></div>`;}
  function dashboard(){
    if(!S.user?.is_admin){
      return shell(`${pageHead('PERSONAL STUDIO','欢迎来到 TrendMint','选一张喜欢的照片，试试你的第一条视频。',`<button class="btn btn-primary" data-nav="/studio">${ic('spark')} 立即开始</button>`)}
      <div class="stat-grid">${metric('可用积分',String(S.user.credits),'生成视频使用积分','bolt')}${metric('总生成任务',String(S.jobs.length),'你的个人视频任务','video','blue')}${metric('已完成',String(S.jobs.filter(x=>x.status==='completed').length),'随时查看并下载','check','green')}${metric('可用模板',String(S.templates.length),'不断加入新场景','spark','gold')}</div>
      <div class="card-heading"><div><div class="card-title">创意模板库</div><div class="card-subtitle">选择想玩的主题，上传照片即可开始。</div></div><button class="section-action" data-nav="/studio">查看全部 ${ic('arrow','sm')}</button></div><div class="template-grid">${S.templates.map(templateCard).join('')}</div>`,'我的工作台','从创意到视频，一步完成');
    }
    const a=S.overview||{};
    let sampleCount=S.trends.filter(x=>x.is_sample).length;
    return shell(`${pageHead('INTELLIGENCE OVERVIEW','从趋势中发现下一门生意','热点发现、快速制作、收入监控。你的 AI 创业作战室。',`<button class="btn btn-outline" data-nav="/trends">${ic('radar')} 趋势雷达</button><button class="btn btn-primary" data-nav="/studio">${ic('plus')} 创建视频</button>`)}
      <div class="stat-grid">${metric('累计真实收入',dollar(a.revenue_usd),'Stripe 已验证收款；不含演示充值','wallet')}${metric('活跃用户',num(a.users),'注册账户数量','users','blue')}${metric('视频生成任务',num(a.jobs),'完成 '+num(a.completed)+' · 进行中 '+num(a.active_jobs),'video','green')}${metric('估算贡献额',dollar(a.contribution_estimate_usd),'未扣手续费、退款及固定成本','chart','gold')}</div>
      <div class="two-col"><section class="panel panel-pad"><div class="card-heading"><div><div class="card-title">${ic('radar','sm')} 热点候选榜</div><div class="card-subtitle">${sampleCount?'含 '+sampleCount+' 条演示候选。':''}增长信号为空时，不推断热度。</div></div><button class="section-action" data-nav="/trends">全部线索 ${ic('arrow','sm')}</button></div>
        ${trendTable(S.trends.slice(0,5),false)}</section>
      <div class="stack"><div class="insight-card"><span class="insight-bubble">✦ 策略提示 / NEXT MOVE</span><h3>不要追每一个热点。<br/>追值得付费的需求。</h3><p>先选一个趋势，做 3 条演示视频，验证搜索需求与购买行为，然后再扩大。</p><button class="btn btn-soft btn-sm" data-nav="/trends" style="margin-top:9px;position:relative;z-index:2">查看机会评分 ${ic('arrow','sm')}</button></div>
      <div class="panel panel-pad"><div class="card-heading"><div><div class="card-title">今日系统状态</div><div class="card-subtitle">不伪造流量与收益数据</div></div></div>
      ${statusLine('演示生成', S.health?.mode==='demo'?'演示模式':'真实模式', 'video')}${statusLine('YouTube 采集',S.health?.youtube_configured?'API 已配置':'待配置 API Key','radar')}${statusLine('支付系统',S.health?.payments_configured?'已配置':'待配置 Stripe','wallet')}
      <div class="divider"></div><p class="small muted">${esc(a.disclaimer||'真实收入与成本要分别核算。')}</p></div></div></div>
      <div style="height:26px"></div><div class="card-heading"><div><div class="card-title">创意模板工厂</div><div class="card-subtitle">同一套账号、积分和生成队列，可接入不同的玩法。</div></div><button class="section-action" data-nav="/studio">进入创作 ${ic('arrow','sm')}</button></div><div class="template-grid">${S.templates.map(templateCard).join('')}</div>`,'总览控制台','趋势、产品、收入，一屏掌握');
  }
  function statusLine(name,val,ico){return `<div class="line-item"><div class="mini-icon">${ic(ico)}</div><div><strong>${esc(name)}</strong><p>${esc(val)}</p></div></div>`;}
  function trendTable(items,full=true){
    if(!items?.length)return `<div class="empty-state"><div class="huge">◉</div><h3>还没有趋势数据</h3><p>请添加候选关键词，或者配置 YouTube API 后开始采集。</p></div>`;
    return `<div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>趋势 / 关键词</th><th>信号</th><th>机会评分</th>${full?'<th>采样播放</th>':''}<th>状态</th><th></th></tr></thead><tbody>${items.map(t=>`<tr><td><div class="trend-label">${esc(t.title)}</div><div class="trend-keyword">${esc(t.keyword)}</div></td>
      <td>${t.is_sample?'<span class="pill amber">示例候选</span>':t.growth_pct==null?'<span class="pill gray">待二次采样</span>':`<span class="pill teal">+${esc(t.growth_pct)}%*</span>`}</td>
      <td><div class="score-track"><span>${t.score}</span><span class="score-bg"><span class="score-fill" style="display:block;width:${t.score}%"></span></span></div></td>
      ${full?`<td class="muted">${displayCompact(t.sample_views)}</td>`:''}<td><span class="pill ${t.stage==='已上线'?'teal':t.stage==='暂缓'?'gray':'blue'}">${esc(t.stage)}</span></td>
      <td><button class="link-btn" title="审核线索" data-action="open-review" data-id="${t.id}">${ic('arrow','sm')}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function trends(){
    if(!S.user?.is_admin)return shell('<div class="empty-state"><h3>需要管理员权限</h3></div>','趋势雷达','管理员专属');
    const last=S.overview?.last_collection;
    return shell(`${pageHead('TREND INTELLIGENCE','AI 趋势雷达','用可信的公开数据寻找高潜力 AI 视频玩法，而不是凭感觉下注。',`<a href="/api/admin/report" class="btn btn-outline">${ic('download')} 下载日报</a><button class="btn btn-outline" data-action="add-trend">${ic('plus')} 添加关键词</button><button class="btn btn-primary" data-action="collect">${ic('refresh')} 立即采集 YouTube</button>`)}
    <div class="note-box" style="margin-bottom:21px">${ic('info','sm')} 当前采集来自官方 YouTube Data API。<b>“采样播放量”不是全网总播放量</b>；首次采样无法计算增长率，至少两次间隔 4 小时的相同视频观测才会显示增长。Instagram/TikTok 可人工录入线索。${!S.health?.youtube_configured?'<strong class="text-amber"> 当前未设置 YOUTUBE_API_KEY。</strong>':''}</div>
    <section class="panel panel-pad" style="margin-bottom:21px"><div class="card-heading"><div><div class="card-title">机会评分与候选跟踪</div><div class="card-subtitle">增长 25 / 需求 25 / 付费 20 / 竞争机会 15 / 可行与合规 15 分</div></div><span class="pill gray">${num(S.trends.length)} 个候选</span></div>
    ${trendTable(S.trends)}<p class="tiny muted" style="margin:13px 0 0">* 增长率为已重复采样视频的播放量变化 / 上次采样播放量，未做全平台推断；评分含人工判断维度。</p></section>
    <div class="two-col"><div class="panel panel-pad"><div class="card-heading"><div><div class="card-title">新发现的视频线索</div><div class="card-subtitle">按最近一次采样排序；播放/小时为发布以来均值，不代表当前增速。</div></div><span class="pill gray">YouTube</span></div>
    ${S.discoveries.length?S.discoveries.slice(0,12).map(d=>`<div class="line-item" style="border-bottom:1px solid #2b2d43"><div class="mini-icon">${ic('play')}</div><div style="flex:1;min-width:0"><strong>${esc(d.title)}</strong><p>播放 ${displayCompact(d.views)} · 发布以来 ${d.velocity_per_hour==null?'暂无':displayCompact(d.velocity_per_hour)+'/小时'} · ${d.video_age_hours!=null?Math.round(d.video_age_hours)+' 小时前发布':''}</p><div style="display:flex;gap:11px;margin-top:9px"><a class="text-purple tiny" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">查看视频 ↗</a>${!d.promoted?`<button class="section-action" data-action="promote" data-id="${d.id}">加入候选 +</button>`:'<span class="pill teal">已加入</span>'}</div></div></div>`).join(''):`<div class="empty-state"><div class="huge">📡</div><h3>还没有实时发现数据</h3><p>在 Cloudflare Worker Secrets 设置 YOUTUBE_API_KEY，点击「立即采集」后会出现新视频线索。</p></div>`}</div>
    <div class="stack"><div class="panel panel-pad"><div class="card-title">采集流程</div><div class="divider"></div>${statusLine('搜索近期视频','固定候选词 + 公开泛关键词','search')}${statusLine('读取播放量','按 video ID 获取官方统计数据','chart')}${statusLine('累积观测','同一视频至少间隔 4 小时再计算增长','clock')}${statusLine('人工审核','确认可模板化、购买意图及素材授权','shield')}</div>
    <div class="panel panel-pad"><div class="card-title">最近一次采集</div><div class="divider"></div>${last?`<div class="text-teal">${esc(last.status)}</div><p class="small muted">${esc(last.detail)}</p><div class="tiny muted">${dt(last.time)}</div>`:'<p class="small muted">尚未执行采集。配置 API 后可手动运行，Cloudflare 定时任务每日采集一次。</p>'}</div></div></div>`,'趋势雷达','真实信号与人工判断分开');
  }
  function studio(){
    if(!S.templates.length)return shell('还没有模板。','AI 创作工坊','');
    const t=S.templates.find(x=>x.slug===S.selected)||S.templates[0];
    return shell(`${pageHead('AI CREATION STUDIO','把灵感变成作品','选择模板、上传一张照片，一键开始制作。',`<button class="btn btn-outline" data-nav="/jobs">${ic('video')} 我的任务</button>${S.user?.is_admin?`<button class="btn btn-primary" data-action="new-template">${ic('plus')} 发布新模板</button>`:''}`)}
    ${S.health?.mode==='demo'?`<div class="note-box" style="margin-bottom:23px;border-color:#775580;color:#f2caed">${ic('info','sm')} <b>当前为功能演示模式：</b>会生成真实可下载的照片动效 MP4，但不是 AI 推理结果。启用 FAL_KEY 和 VIDEO_PROVIDER=fal 后才会调用真实 AI 模型。</div>`:''}
    <div class="studio-layout"><div class="panel panel-pad"><div class="card-heading"><div><div class="card-title">01 / 选择创作模板</div><div class="card-subtitle">一个模板 = 一套 Prompt + 模型参数</div></div></div>
    <div class="studio-templates">${S.templates.map(x=>`<button class="studio-option ${t.slug===x.slug?'selected':''}" data-action="select-template" data-slug="${esc(x.slug)}"><span class="emoji">${esc(x.emoji)}</span><span class="detail"><strong>${esc(x.title)}</strong><small>${x.credits} 积分 / 5秒生成</small></span></button>`).join('')}</div>
    <div class="divider"></div><div class="card-title" style="margin-bottom:13px">02 / 上传参考照片</div>
    <label class="upload-box" id="drop-zone" for="file-input"><input id="file-input" type="file" accept="image/jpeg,image/png,image/webp" />${S.preview?`<img class="upload-preview" src="${S.preview}" alt="准备生成的参考照片" />`:`<div class="upload-message"><span class="upload-icon">${ic('upload','lg')}</span><strong>点击上传，或将照片拖到这里</strong><p>支持 JPG / PNG / WEBP · 最大 4 MB<br/>照片不会被公开展示</p></div>`}</label>
    <form id="generate-form"><div class="field"><label>03 / 可选描述</label><textarea name="prompt" maxlength="300" placeholder="例如：更温柔的动作，镜头慢慢靠近，暖色调..."></textarea></div>
    <label class="check-line"><input type="checkbox" name="rights" required/>我拥有上传图片的使用权，并已取得相关肖像授权；内容不侵犯第三方权利。</label>
    <button class="btn btn-primary btn-block btn-lg" type="submit" style="margin-top:20px">${ic('spark')} 开始生成 · ${t.credits} 积分</button><p class="tiny muted" style="text-align:center;line-height:1.8">失败任务将自动退还积分。你的余额：${num(S.user?.credits)} 积分。</p></form></div>
    <div class="stack"><div class="panel panel-pad"><div class="card-heading"><div><div class="card-title">模板创意预览</div><div class="card-subtitle">创意场景示意，不是实际生成视频</div></div></div><div class="studio-example"><div class="glow-circle"></div><span class="figure">${esc(t.emoji)}</span><div class="example-label"><strong>${esc(t.title)}</strong><span>9:16 VERTICAL</span></div></div><div class="steps"><span class="step"><span class="step-num">1</span> 上传照片</span><span class="arrowline"></span><span class="step"><span class="step-num">2</span> 提交队列</span><span class="arrowline"></span><span class="step"><span class="step-num">3</span> 下载视频</span></div></div>
    <div class="panel panel-pad"><div class="card-title">生成说明</div><p class="small muted" style="line-height:2">${esc(t.description)}<br/>生成时默认采用安全的原创画面描述，不捆绑未经授权的热门歌曲或表演素材。</p><div class="divider"></div><div class="line-item"><span class="mini-icon">${ic('shield')}</span><div><strong>隐私与权限</strong><p>上传文件独立保存在服务端私有目录，生成结果下载需要登录。源照片在生成结束后删除；本地生成视频默认保留 7 天。</p></div></div></div></div></div>`,'AI 创作工坊','模板化视频生成');
  }
  function jobs(){
    return shell(`${pageHead('GENERATION QUEUE','我的生成任务','查看等待、生成中、已完成和失败的任务。',`<button class="btn btn-outline" data-action="refresh-jobs">${ic('refresh')} 刷新</button><button class="btn btn-primary" data-nav="/studio">${ic('plus')} 创建新任务</button>`)}
    ${S.jobs?.length?`<div class="jobs-grid">${S.jobs.map(j=>`<div class="panel job-card"><div class="job-preview"><span>🎞️</span><small>${esc(j.provider==='demo'?'演示照片动效':'AI VIDEO')}</small></div><h4>${esc(j.template_name)}</h4><p>任务 #${esc(j.id.slice(0,8))} · ${dt(j.created_at)}</p><div class="job-footer"><span class="pill ${j.status==='completed'?'teal':j.status==='failed'?'red':j.status==='processing'?'blue':'gray'}">${{queued:'排队中',processing:'生成中',completed:'已完成',failed:'失败退分'}[j.status]||esc(j.status)}</span>
    ${j.status==='completed' && j.download_url?`<a href="${esc(j.download_url)}" class="btn btn-success btn-sm">${ic('download','sm')} 下载</a>`:j.status==='completed'?'<span class="tiny muted">文件已过期</span>':j.status==='failed'?`<button class="btn btn-danger btn-sm" title="${esc(j.error||'未知错误')}">查看错误</button>`:`<span class="tiny muted">处理中...</span>`}</div>${j.error?`<p class="text-red small">${esc(j.error)}</p>`:''}</div>`).join('')}</div>`:`<div class="panel empty-state"><div class="huge">🎬</div><h3>你的第一条视频，还在等你</h3><p>从任意一个模板开始，只需要上传一张照片。</p><button class="btn btn-primary" data-nav="/studio">开始制作 ${ic('arrow','sm')}</button></div>`}
    <div class="note-box" style="margin-top:20px">${ic('info','sm')} 演示模式生成的视频带有明确水印。若任务出现失败，将自动返还对应的积分。</div>`,'我的任务','从任务到视频');
  }
  function billing(){
    const w=S.wallet||{};const packs=S.plans.filter(x=>x.kind==='pack'), subs=S.plans.filter(x=>x.kind==='subscription');
    return shell(`${pageHead('BILLING & CREDITS','积分与定价','先买所需的额度，再逐步升级；一次性积分包没有自动续费。',`<button class="btn btn-outline" data-nav="/studio">${ic('spark')} 使用积分</button>`)}
    <div class="panel balance-card"><div><div class="eyebrow">YOUR BALANCE</div><div class="balance">${num(w.balance??S.user.credits)} <span style="font-size:13px;color:#b8aad8;letter-spacing:0">积分</span></div><span class="small muted">每条模板视频 6 积分。支付只在 Stripe Webhook 验证后入账。</span></div><div style="font-size:55px;color:#c3aaff">✦</div></div>
    <div class="card-heading"><div><div class="card-title">一次性积分包</div><div class="card-subtitle">适合热点娱乐工具用户：按需付费，不必订阅。</div></div></div>
    <div class="billing-grid">${packs.map((p,i)=>priceCard(p,i===1)).join('')}</div>
    <div class="card-heading" style="margin-top:36px"><div><div class="card-title">月度订阅</div><div class="card-subtitle">适合经常创作的用户，自动续费，需提供自助取消入口后再公开推广。</div></div></div>
    <div class="billing-grid" style="margin-bottom:29px">${subs.map(p=>priceCard(p,false)).join('')}</div>
    ${(w.subscriptions||[]).length?`<button class="btn btn-outline" data-action="portal" style="margin:3px 0 20px">${ic('settings','sm')} 管理 / 取消我的订阅（Stripe）</button>`:''}
    ${S.health?.payments_configured?'':`<div class="note-box" style="margin-bottom:20px">${ic('info','sm')} 当前尚未接入 Stripe，因此不会发生真实收款。${S.health?.mode==='demo'?'可点击「演示充值」测试积分增加与任务流程；演示充值不计营业收入。':''}</div>`}
    ${S.health?.mode==='demo'?`<button class="btn btn-soft" data-action="topup">${ic('bolt')} 演示充值 +20 积分（不收费）</button>`:''}
    <section class="panel panel-pad" style="margin-top:24px"><div class="card-heading"><div><div class="card-title">积分流水</div><div class="card-subtitle">真实数据库流水，按时间倒序</div></div></div>
    ${(w.ledger||[]).length?`<div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>时间</th><th>事件</th><th>变更</th><th>变更后余额</th></tr></thead><tbody>${w.ledger.map(e=>`<tr><td class="muted">${dt(e.created_at)}</td><td>${esc(e.reason)}</td><td class="${e.delta>0?'text-teal':'text-amber'}">${e.delta>0?'+':''}${e.delta}</td><td>${num(e.balance)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">还没有积分流水</div>'}</section>`,'积分与支付','所有账目清晰可查');
  }
  function priceCard(p,featured){return `<div class="panel price-card ${featured?'featured':''}">${featured?'<span class="badge-popular">RECOMMENDED</span>':''}<h3>${esc(p.name)}</h3><div class="price">$${(p.price/100).toFixed(2)} <span style="font-size:12px;color:#9295af;letter-spacing:0">${p.kind==='subscription'?'/ 月':''}</span></div><p>包含 <strong style="color:#cab4ff">${p.credits} 积分</strong> · 约 ${Math.floor(p.credits/6)} 条模板短视频。${p.kind==='subscription'?'月度自动续费，续费成功时发放积分。':'一次性购买，不自动续费。'}</p><button class="btn ${featured?'btn-primary':'btn-outline'} btn-block" data-action="checkout" data-id="${esc(p.id)}" ${S.health?.payments_configured?'':'disabled'}>${S.health?.payments_configured?'前往 Stripe 付款':'支付待接入'} ${ic('arrow','sm')}</button></div>`;}
  function settings(){return shell(`${pageHead('SYSTEM CONFIGURATION','系统设置与集成','部署前检查真实 API、支付和管理员账号。')}
    <div class="two-col"><div class="panel panel-pad"><div class="card-title">集成状态</div><div class="divider"></div>${statusLine('视频模型',S.health?.real_video_configured?'Fal API 已配置':'演示模式 / 尚未接入 FAL_KEY','video')}${statusLine('YouTube Data API',S.health?.youtube_configured?'已配置':'尚未配置 Key','radar')}${statusLine('Stripe 支付',S.health?.payments_configured?'已配置 Secret + Webhook':'未配置，不会真实收款','wallet')}
    <div class="divider"></div><p class="small muted">由于密钥属于服务端敏感信息，只能在 .env、容器或云端 Secret Manager 中配置，不能在浏览器里输入或保存。</p></div>
    <div class="panel panel-pad"><div class="card-title">账号信息</div><div class="divider"></div><div class="line-item"><div class="avatar">${esc(S.user.email[0].toUpperCase())}</div><div><strong>${esc(S.user.email)}</strong><p>角色：${S.user.is_admin?'管理员':'普通用户'} · 创建时间 ${dt(S.user.created_at)}</p></div></div><div class="divider"></div><div class="note-box">生产环境必须使用 HTTPS、SESSION_SECRET、持久 D1 数据库，并使用服务端 CLI 提升管理员权限。请先在 Stripe 测试模式走通支付和 Webhook，再启用真实收费。</div><button class="btn btn-outline" style="margin-top:19px" data-action="logout">${ic('logout')} 退出登录</button></div></div>
    ${S.user.is_admin?`<section class="panel panel-pad" style="margin-top:22px"><div class="card-heading"><div><div class="card-title">模板工厂管理</div><div class="card-subtitle">无需重新开发账号与支付。新建模板即可生成独立 URL；下架不删除历史订单。</div></div><button class="btn btn-primary btn-sm" data-action="new-template">${ic('plus')} 新增模板</button></div><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>名称 / SEO 链接</th><th>积分</th><th>状态</th><th>操作</th></tr></thead><tbody>${(S.adminTemplates||[]).map(t=>`<tr><td><strong>${esc(t.title)}</strong><br/><span class="tiny muted">/t/${esc(t.slug)}</span></td><td>${t.credits}</td><td><span class="pill ${t.active?'teal':'gray'}">${t.active?'已上线':'已下架'}</span></td><td><button class="section-action" data-action="toggle-template" data-id="${t.id}" data-active="${t.active}">${t.active?'下架':'上架'}</button></td></tr>`).join('')}</tbody></table></div></section>`:''}`,'系统设置','API 与安全配置');}
  function siteLanding(){
    const routeSlug=route().startsWith('/t/')?route().slice(3):null;
    const focus=S.templates.find(t=>t.slug===routeSlug);
    let heroTitle=focus?`让照片变成<br/><em>${esc(focus.title_en)}</em>`:'把正在爆火的灵感，<br/><em>变成你的作品。</em>';
    return `<div class="site"><div class="site-header">${brand()}<div class="site-links"><a href="#templates">AI 视频模板</a><a href="#how">工作原理</a><a href="#about">关于我们</a></div><div class="site-header-actions"><button class="btn btn-outline" data-action="login">登录</button><button class="btn btn-primary" data-action="demo">${ic('spark','sm')} 进入工作台</button></div></div>
    <section class="hero"><div>${S.health?.mode==='demo'?'<div class="site-demo-banner">✦ 演示环境 · 可试用照片动效，非真实 AI 推理</div>':''}<div class="eyebrow"><span class="dot"></span>CREATE WHAT'S NEXT</div><h1>${heroTitle}</h1><p>${focus?esc(focus.description_en):'发现正在流行的 AI 影像玩法，把普通照片变成值得分享的短视频。一个模板、一次上传、一键生成。'}</p>
    <div class="hero-actions"><button class="btn btn-primary btn-lg" data-action="demo">${ic('spark')} ${S.health?.mode==='demo'?'免费体验演示':'创建账户'} ${ic('arrow','sm')}</button><button class="btn btn-outline btn-lg" data-action="login">登录账户</button></div>
    <div class="hero-foot"><span>${ic('check','sm')} 简单易用</span><span>${ic('shield','sm')} 私有照片存储</span><span>${ic('bolt','sm')} 按需积分制</span></div></div>
    <div class="hero-showcase"><div class="hero-photo">${focus?esc(focus.emoji):'🐈'}<div class="play-marker">${ic('play','lg')}</div></div><div class="float-card one"><div class="float-ico">${ic('spark')}</div><div><strong>AI Creative Studio</strong><small>One photo, endless ideas</small></div></div><div class="float-card two"><div class="float-ico" style="color:#73e9c2;background:#254943">${ic('check')}</div><div><strong>Ready to share</strong><small>Vertical video · 9:16</small></div></div><div class="bottom-wordmark">✦ TRENDMINT STUDIO</div></div></section>
    <section class="site-section" id="templates"><div class="section-kicker">YOUR NEXT CREATION</div><h2 class="section-heading">不止一种创意，持续探索新玩法。</h2><p class="section-caption">以下为创意模板示意。真实 AI 生成仅在完成提供商配置后可用。</p><div class="template-grid">${S.templates.map(templateCard).join('')}</div></section>
    <section class="site-section" id="how"><div class="section-kicker">HOW IT WORKS</div><h2 class="section-heading">三步，做出你的专属短视频。</h2><div class="process-grid"><div class="panel process-card"><div class="process-number">STEP 01</div><h3>选择模板</h3><p>探索创意玩法，找到你喜欢的视觉风格。</p></div><div class="panel process-card"><div class="process-number">STEP 02</div><h3>上传照片</h3><p>只需一张清晰参考照片，可选填自己的描述。</p></div><div class="panel process-card"><div class="process-number">STEP 03</div><h3>生成并分享</h3><p>系统排队处理任务，完成后登录即可下载。</p></div></div></section>
    <div class="site-footer" id="about"><span>© 2026 TrendMint. An original AI creative toolkit.</span><span>尊重内容版权 · 请使用有授权的照片与素材 · 非关联热门音乐品牌</span></div></div>`;
  }
  function renderModal(){
    if(!S.modal)return '';
    const m=S.modal;
    if(m.type==='auth'){
      let isLogin=S.formMode==='login';
      return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="用户登录"><button class="x" data-action="close-modal">${ic('close','sm')}</button><div class="eyebrow">${isLogin?'WELCOME BACK':'JOIN TRENDMINT'}</div><h2>${isLogin?'登录工作台':'创建你的账户'}</h2><p>登录后即可查看生成任务、积分和模板。</p><form id="auth-form"><div class="field"><label>邮箱</label><input type="email" name="email" placeholder="you@example.com" required autocomplete="email"/></div><div class="field"><label>密码</label><input type="password" name="password" placeholder="至少 8 位" minlength="8" required autocomplete="${isLogin?'current-password':'new-password'}"/></div><button class="btn btn-primary btn-block" type="submit">${isLogin?'登录':'注册并继续'} ${ic('arrow','sm')}</button></form><button class="switch" data-action="auth-switch">${isLogin?'还没有账户？点击注册':'已有账户？返回登录'}</button>${S.health?.mode==='demo'?'<div class="divider"></div><button class="btn btn-outline btn-block" data-action="demo">无需注册 · 直接使用演示账号</button>':''}</div></div>`;
    }
    if(m.type==='new-template')return `<div class="modal-backdrop" data-action="close-modal"><div class="modal wide" role="dialog" aria-modal="true" aria-label="发布新模板"><button class="x" data-action="close-modal">${ic('close')}</button><div class="eyebrow">SITE FACTORY / TEMPLATE MAKER</div><h2>发布一个新玩法</h2><p>一次配置即可拥有专属 SEO 路径、提示词、生成入口及统一积分计费。原创素材、授权与模型适配需自行验证。</p><form id="new-template-form"><div class="grid-2"><div class="field"><label>中文名称</label><input name="title" required minlength="2" maxlength="100" placeholder="例如 会说话的宠物" /></div><div class="field"><label>英文标题（SEO）</label><input name="title_en" required minlength="3" maxlength="120" placeholder="AI Talking Pet Video" /></div></div><div class="field"><label>英文 URL slug</label><input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" minlength="3" maxlength="70" placeholder="ai-talking-pet" required/></div><div class="field"><label>中文简介</label><input name="description" minlength="6" maxlength="600" placeholder="上传宠物照片，一键生成会说话的趣味片段" required /></div><div class="field"><label>英文简介（搜索描述）</label><input name="description_en" minlength="6" maxlength="600" placeholder="Turn your favorite pet photo into a fun original video." required /></div><div class="field"><label>真实模型的 Prompt（建议英文）</label><textarea name="prompt" minlength="30" maxlength="2500" required placeholder="Describe your original scene, camera movement, facial expression, 9:16 composition, and visual quality."></textarea></div><div class="grid-2"><div class="field"><label>封面图标（Emoji）</label><input name="emoji" value="✨" maxlength="8" required /></div><div class="field"><label>每次消耗积分</label><input name="credits" type="number" min="1" max="100" value="6" required /></div></div><div class="modal-actions"><button class="btn btn-outline" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${ic('plus')} 创建模板</button></div></form></div></div>`;
    if(m.type==='add')return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true"><button class="x" data-action="close-modal">${ic('close')}</button><div class="eyebrow">TRACK A NEW IDEA</div><h2>添加热点候选</h2><p>支持手动从 Instagram、TikTok、Reddit 等渠道添加线索；没有真实增速时不填写假数据。</p><form id="trend-add-form"><div class="field"><label>玩法名称</label><input name="title" placeholder="例如 AI Talking Pet" required maxlength="160" /></div><div class="field"><label>追踪关键词</label><input name="keyword" placeholder="例如 AI talking pet video" required maxlength="160" /></div><div class="field"><label>视频或线索 URL（选填）</label><input name="url" type="url" placeholder="https://..." /></div><div class="field"><label>备注</label><textarea name="notes" placeholder="为什么值得做？如何变现？" maxlength="1000"></textarea></div><div class="modal-actions"><button class="btn btn-outline" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${ic('plus','sm')} 加入雷达</button></div></form></div></div>`;
    if(m.type==='review'){
      const t=S.trends.find(x=>x.id===m.id);if(!t)return '';
      const ratings=[['demand','需求强度（25分）'],['willingness','购买意愿（20分）'],['opportunity','竞争机会（15分）'],['feasibility','实现可行性（含成本）'],['compliance','素材授权与合规']];
      const options=['待验证','测试中','已上线','暂缓'];
      return `<div class="modal-backdrop" data-action="close-modal"><div class="modal wide" role="dialog" aria-modal="true"><button class="x" data-action="close-modal">${ic('close')}</button><div class="eyebrow">TREND REVIEW · #${t.id}</div><h2>${esc(t.title)}</h2><p>关键词：${esc(t.keyword)}。${t.is_sample?'这是一条演示记录，没有真实平台采样。':t.growth_pct==null?'尚无可比较的增长率，不能推断上涨。':'已具备重复采样的播放量变化。'}</p>
      ${t.source_url?`<p><a href="${esc(t.source_url)}" target="_blank" rel="noopener noreferrer" class="text-purple">查看原始线索 ↗</a></p>`:''}
      <form id="trend-review-form"><div class="studio-templates">${ratings.map(([id,label])=>`<div class="field" style="margin:5px 0"><label>${label}</label><select name="${id}">${[1,2,3,4,5].map(v=>`<option value="${v}" ${t[id]===v?'selected':''}>${v} / 5</option>`).join('')}</select></div>`).join('')}</div>
      <div class="field"><label>推进阶段</label><select name="stage">${options.map(s=>`<option ${s===t.stage?'selected':''}>${s}</option>`).join('')}</select></div><div class="field"><label>分析备注</label><textarea name="notes" maxlength="1000">${esc(t.notes)}</textarea></div><div class="modal-actions"><button class="btn btn-outline" type="button" data-action="evidence" data-id="${t.id}">视频证据 ${ic('external','sm')}</button><button class="btn btn-primary" type="submit">保存评分</button></div></form>
      <p class="tiny muted">当前机会评分：${t.score}/100。增长信号未知时按 0 分计入，不伪造趋势增速。</p></div></div>`;
    }
    if(m.type==='evidence')return `<div class="modal-backdrop" data-action="close-modal"><div class="modal wide"><button class="x" data-action="close-modal">${ic('close')}</button><h2>真实视频证据</h2><p>以下是通过 YouTube API 获得的视频观测。只收集标题、链接与公开视频统计，不下载他人视频。</p>${m.items?.length?m.items.map(v=>`<div class="line-item"><span class="mini-icon">${ic('video')}</span><div><strong>${esc(v.title)}</strong><p>播放：${displayCompact(v.views)} · 上次：${displayCompact(v.prev_views)} · ${dt(v.observed_at)}</p><a href="${esc(v.url)}" class="text-purple tiny" target="_blank" rel="noopener noreferrer">官方视频链接 ↗</a></div></div>`).join(''):'<div class="empty-state"><p>当前还没有视频证据，需要配置 API 后采集。</p></div>'}</div></div>`;
    return '';
  }
  function render(){
    const path=route();let html;
    if(!S.user)html=siteLanding();
    else if(path==='/dashboard'||path==='/')html=dashboard();
    else if(path==='/trends')html=trends();
    else if(path==='/studio'||path.startsWith('/t/'))html=studio();
    else if(path==='/jobs')html=jobs();
    else if(path==='/billing')html=billing();
    else if(path==='/settings')html=settings();
    else html=dashboard();
    $('#app').innerHTML=html+renderModal();
    if(path==='/studio'&&S.preview){const img=$('.upload-preview');if(img)img.src=S.preview;}
  }
  async function demoLogin(){await safe(async()=>{S.user=await request('/auth/demo',{method:'POST'});toast('已进入演示工作台 · 不涉及真实支付');navigate('/dashboard');});}
  async function logout(){await safe(async()=>{await request('/auth/logout',{method:'POST'});S.user=null;S.modal=null;S.wallet=null;S.overview=null;navigate('/');toast('已安全退出');});}
  async function doCollect(){await safe(async()=>{toast('开始采集 YouTube 数据，结果来自官方 API');const r=await request('/admin/collect',{method:'POST'});toast(`采集结果：${r.tracked} 个关键词，${r.discoveries} 条视频${r.errors?.length?'（部分失败）':''}`);const [ts,ds,o]=await Promise.all([request('/admin/trends'),request('/admin/discoveries'),request('/admin/overview')]);S.trends=ts;S.discoveries=ds;S.overview=o;render();});}
  async function doCheckout(id){await safe(async()=>{const r=await request('/billing/checkout',{method:'POST',body:{product_id:id}});if(!r.checkout_url.startsWith('https://checkout.stripe.com/'))throw Error('付款 URL 验证失败');location.assign(r.checkout_url);});}
  async function handleClick(event){
    if(event.target.closest('a[data-nav]'))event.preventDefault();
    const navEl=event.target.closest('[data-nav]');
    if(navEl){event.preventDefault();navigate(navEl.dataset.nav);return;}
    const el=event.target.closest('[data-action]');if(!el)return;
    let a=el.dataset.action;
    if(a==='close-modal'&&event.target.closest('.modal')&&!event.target.closest('.x'))return;
    if(a==='mobile-close'){S.navOpen=false;render();return;}
    if(a==='mobile-open'){S.navOpen=!S.navOpen;render();return;}
    if(a==='close-modal'){S.modal=null;render();return;}
    if(a==='demo'){if(S.health?.mode==='demo')return demoLogin();S.formMode='register';S.modal={type:'auth'};render();return;}
    if(a==='login'||a==='register'){S.formMode=a;S.modal={type:'auth'};render();return;}
    if(a==='auth-switch'){S.formMode=S.formMode==='login'?'register':'login';render();return;}
    if(a==='logout')return logout();
    if(a==='open-template'){S.selected=el.dataset.slug;return S.user?navigate('/studio'):(S.modal={type:'auth'},render());}
    if(a==='select-template'){S.selected=el.dataset.slug;render();return;}
    if(a==='refresh-jobs')return safe(async()=>{await loadJobs();toast('已刷新任务');});
    if(a==='new-template'){S.modal={type:'new-template'};render();return;}
    if(a==='toggle-template')return safe(async()=>{const id=Number(el.dataset.id), active=el.dataset.active==='true';await request('/admin/templates/'+id,{method:'PATCH',body:{active:!active}});const [list,published]=await Promise.all([request('/admin/templates'),request('/public/templates')]);S.adminTemplates=list;S.templates=published;render();toast(active?'模板已下架':'模板已上架');});
    if(a==='add-trend'){S.modal={type:'add'};render();return;}
    if(a==='open-review'){S.modal={type:'review',id:Number(el.dataset.id)};render();return;}
    if(a==='collect')return doCollect();
    if(a==='checkout')return doCheckout(el.dataset.id);
    if(a==='portal')return safe(async()=>{const r=await request('/billing/portal',{method:'POST'});if(!r.portal_url.startsWith('https://billing.stripe.com/'))throw Error('订阅管理地址无效');location.assign(r.portal_url);});
    if(a==='topup')return safe(async()=>{const d=await request('/billing/demo-topup',{method:'POST'});S.user.credits=d.balance;S.wallet=await request('/wallet');render();toast('演示积分 +20（没有发生付款）');});
    if(a==='promote')return safe(async()=>{await request('/admin/discoveries/'+el.dataset.id+'/promote',{method:'POST'});S.trends=await request('/admin/trends');S.discoveries=await request('/admin/discoveries');render();toast('已加入候选库，请人工评估');});
    if(a==='evidence')return safe(async()=>{const items=await request('/admin/trends/'+el.dataset.id+'/evidence');S.modal={type:'evidence',items};render();});
  }
  async function handleSubmit(event){
    const id=event.target.id;
    if(!['auth-form','trend-add-form','trend-review-form','generate-form','new-template-form'].includes(id))return;
    event.preventDefault();const form=event.target, values=Object.fromEntries(new FormData(form).entries());
    if(id==='auth-form')return safe(async()=>{S.user=await request('/auth/'+(S.formMode==='login'?'login':'register'),{method:'POST',body:{email:values.email,password:values.password}});S.modal=null;S.wallet=null;toast('欢迎来到 TrendMint');navigate('/dashboard');});
    if(id==='new-template-form')return safe(async()=>{const body={...values,credits:Number(values.credits)};const created=await request('/admin/templates',{method:'POST',body});S.modal=null;S.selected=created.slug;S.templates=await request('/public/templates');toast('模板发布成功，专属页面：/t/'+created.slug);navigate('/studio');});
    if(id==='trend-add-form')return safe(async()=>{await request('/admin/trends',{method:'POST',body:{title:values.title,keyword:values.keyword,source_url:values.url||'',notes:values.notes||''}});S.modal=null;S.trends=await request('/admin/trends');render();toast('已加入候选热点');});
    if(id==='trend-review-form')return safe(async()=>{const id=S.modal.id;const body={stage:values.stage,notes:values.notes||''};for(const key of ['demand','willingness','opportunity','feasibility','compliance'])body[key]=Number(values[key]);await request('/admin/trends/'+id,{method:'PATCH',body});S.modal=null;S.trends=await request('/admin/trends');render();toast('评分和审核状态已保存');});
    if(id==='generate-form')return safe(async()=>{
      if(!S.uploadFile){toast('请先上传一张照片',true);return;}
      const t=S.templates.find(x=>x.slug===S.selected)||S.templates[0];
      const fd=new FormData();fd.append('image',S.uploadFile);fd.append('template_id',String(t.id));fd.append('agree_rights','true');fd.append('custom_prompt',String(values.prompt||''));
      const job=await request('/jobs',{method:'POST',body:fd});
      S.user.credits-=t.credits;S.uploadFile=null;S.preview=null;
      toast('任务已经提交队列，失败将返还积分');navigate('/jobs');
    });
  }
  document.addEventListener('click',handleClick);
  document.addEventListener('submit',handleSubmit);
  document.addEventListener('change',e=>{if(e.target.id==='file-input'&&e.target.files?.[0])selectFile(e.target.files[0]);});
  function selectFile(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('仅支持 JPG/PNG/WEBP',true);return;}if(file.size>4*1024*1024){toast('文件超过 4MB',true);return;}S.uploadFile=file;const reader=new FileReader();reader.onload=()=>{S.preview=reader.result;render();};reader.readAsDataURL(file);}
  document.addEventListener('dragover',e=>{if(e.target.closest('#drop-zone')){e.preventDefault();e.target.closest('#drop-zone').classList.add('dragging');}});
  document.addEventListener('dragleave',e=>{if(e.target.closest('#drop-zone'))e.target.closest('#drop-zone').classList.remove('dragging');});
  document.addEventListener('drop',e=>{if(e.target.closest('#drop-zone')){e.preventDefault();e.target.closest('#drop-zone').classList.remove('dragging');if(e.dataTransfer.files[0])selectFile(e.dataTransfer.files[0]);}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.modal){S.modal=null;render();}if((e.metaKey||e.ctrlKey)&&e.key==='/'){e.preventDefault();if(S.user?.is_admin)navigate('/trends');}});
  init();
})();
