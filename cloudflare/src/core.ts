/* Native Cloudflare Workers/D1/R2 helpers. No browser-side secrets. */
export type Env = {
 DB: any; MEDIA: any; ASSETS: {fetch(input: Request|string):Promise<Response>};
 SESSION_SECRET?:string; FAL_KEY?:string; FAL_MODEL_ID?:string; VIDEO_PROVIDER?:string;
 VIDEO_COST_ESTIMATE_USD?:string;MAX_DAILY_VIDEO_BUDGET_USD?:string;
 STRIPE_SECRET_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;YOUTUBE_API_KEY?:string;
 WEB_BASE_URL?:string;REGISTRATION_ENABLED?:string;PAYMENTS_ENABLED?:string;
};
export type Ctx = {waitUntil(p:Promise<unknown>):void};
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export const fail=(s:number,m:string):never=>{throw new ApiError(s,m)};
export const j=(data:unknown,status=200,headers:HeadersInit={}):Response=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
export const one=async (env:Env,sql:string,...args:any[]):Promise<any>=>env.DB.prepare(sql).bind(...args).first();
export const all=async (env:Env,sql:string,...args:any[]):Promise<any[]>=>((await env.DB.prepare(sql).bind(...args).all()).results||[]);
export const run=async (env:Env,sql:string,...args:any[])=>env.DB.prepare(sql).bind(...args).run();
export const now=()=>new Date().toISOString();
export const ipOf=(req:Request)=>req.headers.get('CF-Connecting-IP')||'local';
export const id=()=>crypto.randomUUID();
const enc=new TextEncoder();
export const b64=(a:ArrayBuffer|Uint8Array):string=>{
 const b=new Uint8Array(a);let s='';for(let i=0;i<b.length;i+=0x4000)s+=String.fromCharCode(...b.subarray(i,i+0x4000));
 return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
};
const unb64=(s:string):Uint8Array=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
export const hex=(arr:ArrayBuffer):string=>Array.from(new Uint8Array(arr)).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function hmac(input:string,secret:string):Promise<string>{
 const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',k,enc.encode(input)));
}
export async function stripeHmac(input:string,secret:string):Promise<string>{
 const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',k,enc.encode(input)));
}
export function timingSafe(a:string,b:string):boolean{ // fixed-length compare after WebCrypto digest, no early exit
 if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
}
async function pbkdf2(password:string,salt:Uint8Array,iterations:number){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt as BufferSource,hash:'SHA-256',iterations},key,256));
}
export async function hashPassword(password:string){const salt=crypto.getRandomValues(new Uint8Array(16));return `pbkdf2_sha256$210000$${b64(salt)}$${await pbkdf2(password,salt,210000)}`;}
export async function verifyPassword(password:string,hash:string){const [method,count,salt,digest]=hash.split('$');if(method!=='pbkdf2_sha256'||!digest||Number(count)<100000)return false;return timingSafe(await pbkdf2(password,unb64(salt),Number(count)),digest);}
export function cookie(req:Request,name:string){return req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
export async function getUser(req:Request,env:Env,required=true):Promise<any|null>{
 const raw=cookie(req,'tm_session'),secret=env.SESSION_SECRET;
 if(raw&&secret){const seg=raw.split('.');if(seg.length===3&&/^\d+$/.test(seg[0])&&/^\d+$/.test(seg[1])&&Number(seg[1])>Date.now()/1000){
   const signature=await hmac(`${seg[0]}.${seg[1]}`,secret);
   if(timingSafe(signature,seg[2])){const u=await one(env,'SELECT * FROM users WHERE id=?',Number(seg[0]));if(u)return u;}
 }}
 if(required)fail(401,'需要登录');return null;
}
export async function admin(req:Request,env:Env){const u=await getUser(req,env);if(!u?.is_admin)fail(403,'需要管理员权限');return u;}
export async function issueSession(user:any,env:Env){
 if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32)return fail(503,'缺少安全会话密钥');
 const exp=Math.floor(Date.now()/1000)+12*3600,body=`${user.id}.${exp}`;
 const token=`${body}.${await hmac(body,env.SESSION_SECRET)}`;
 const csrf=b64(crypto.getRandomValues(new Uint8Array(24)));
 return [`tm_session=${token}; Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax`,
         `tm_csrf=${csrf}; Path=/; Max-Age=43200; Secure; SameSite=Lax`];
}
export function withCookies(data:unknown,cookies:string[],status=200){const res=j(data,status);for(const c of cookies)res.headers.append('Set-Cookie',c);return res;}
export function userPublic(u:any){return {id:u.id,email:u.email,credits:u.credits,is_admin:Boolean(u.is_admin),created_at:u.created_at};}
export async function bodyJson(req:Request){const text=await req.text();if(text.length>20000)fail(413,'请求内容过大');try{return JSON.parse(text)}catch{fail(400,'JSON 无效')}}
export function checkedString(v:any,name:string,min=1,max=255):string{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(422,`${name}格式不正确`);return v.trim();}
export function checkedNum(v:any,name:string,min=0,max=1e7):number{const n=Number(v);if(!Number.isFinite(n)||n<min||n>max||!Number.isInteger(n))fail(422,`${name}不合法`);return n;}
export function csrfCheck(req:Request){
 const url=new URL(req.url),origin=req.headers.get('origin');
 if(origin&&origin!==url.origin)fail(403,'跨站请求被拒绝');
 const token=cookie(req,'tm_csrf'),sent=req.headers.get('X-CSRF-Token')||'';
 if(!token||!sent||!timingSafe(token,sent))fail(403,'CSRF 验证失败');
}
export async function throttle(req:Request,env:Env,kind:string,limit:number){
 const digest=hex(await crypto.subtle.digest('SHA-256',enc.encode(ipOf(req)))).slice(0,28),key=`${kind}:${digest}`;
 const bucket=Math.floor(Date.now()/600000);
 await run(env,`INSERT INTO rate_limits(key,n,window_start) VALUES(?,1,?)
 ON CONFLICT(key) DO UPDATE SET n=CASE WHEN window_start<>excluded.window_start THEN 1 ELSE n+1 END,
 window_start=excluded.window_start`,key,bucket);
 const row=await one(env,'SELECT n FROM rate_limits WHERE key=?',key);
 if(row?.n>limit)fail(429,'操作太频繁，请稍后再试');
}
export async function moveCredits(env:Env,userId:number,delta:number,reason:string,ref:string):Promise<boolean>{
 // batch() executes sequential prepared statements in a single D1 transaction.
 // changes() applies to immediately preceding UPDATE, guarding unique-ledger insert.
 const statements=[
  env.DB.prepare(`UPDATE users SET credits=credits+? WHERE id=? AND credits+? >=0 AND NOT EXISTS(SELECT 1 FROM credit_entries WHERE ref=?)`).bind(delta,userId,delta,ref),
  env.DB.prepare(`INSERT INTO credit_entries(user_id,delta,balance_after,reason,ref)
    SELECT ?,?,credits,?,? FROM users WHERE id=? AND changes()=1`).bind(userId,delta,reason,ref,userId)
 ];
 const result=await env.DB.batch(statements);
 return Number(result[0]?.meta?.changes||0)>0;
}
export const toBool=(s:any)=>s===true||s===1||s==='1';
export const safeUrl=(s:string)=>{try{const u=new URL(s);return u.protocol==='https:'&& !['localhost','127.0.0.1'].includes(u.hostname)}catch{return false}};
export const security=(res:Response)=>{
 res.headers.set('X-Content-Type-Options','nosniff');res.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 res.headers.set('X-Frame-Options','DENY');res.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
 return res;
};
