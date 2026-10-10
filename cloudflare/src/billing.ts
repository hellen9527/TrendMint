import {Env,one,all,run,j,fail,now,checkedString,moveCredits,stripeHmac,timingSafe,id} from './core';
export const PACKS:Record<string,{name:string;price:number;credits:number;kind:'pack'|'subscription'}>={
 spark:{name:'Spark · 入门包',price:490,credits:20,kind:'pack'},
 creator:{name:'Creator · 创作包',price:990,credits:50,kind:'pack'},
 studio:{name:'Studio · 工作室包',price:1990,credits:110,kind:'pack'},
 monthly_basic:{name:'Basic · 月订阅',price:990,credits:50,kind:'subscription'},
 monthly_pro:{name:'Pro · 月订阅',price:1990,credits:120,kind:'subscription'}
};
export const billingReady=(env:Env)=>env.PAYMENTS_ENABLED==='true'&&!!env.STRIPE_SECRET_KEY&&!!env.STRIPE_WEBHOOK_SECRET;
export async function stripe(env:Env,endpoint:string,data?:URLSearchParams):Promise<any>{
 if(!env.STRIPE_SECRET_KEY)fail(503,'Stripe 未设置');
 const res=await fetch('https://api.stripe.com/v1/'+endpoint,{method:data?'POST':'GET',headers:{'Authorization':`Bearer ${env.STRIPE_SECRET_KEY}`,...(data?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:data?.toString()});
 if(!res.ok){console.error('Stripe error',endpoint,res.status);fail(502,'Stripe 调用失败，请检查配置')}
 return res.json();
}
export async function checkout(env:Env,user:any,productId:string):Promise<{checkout_url:string}>{
 const p=PACKS[productId];if(!p)fail(400,'无效商品');if(!billingReady(env))fail(503,'真实支付尚未启用');
 const orderId='ord_'+id().replaceAll('-','').slice(0,24);
 await run(env,`INSERT INTO orders(id,user_id,product_id,amount_cents,credits,kind) VALUES(?,?,?,?,?,?)`,orderId,user.id,productId,p.price,p.credits,p.kind);
 const base=(env.WEB_BASE_URL||'https://trendmint.fategenie.com').replace(/\/$/,'');
 const form=new URLSearchParams({mode:p.kind==='pack'?'payment':'subscription',
 'success_url':base+'/billing?payment=success','cancel_url':base+'/billing?payment=cancel',
 'client_reference_id':String(user.id),'line_items[0][quantity]':'1',
 'payment_method_types[0]':'card','line_items[0][price_data][currency]':'usd',
 'line_items[0][price_data][unit_amount]':String(p.price),
 'line_items[0][price_data][product_data][name]':'TrendMint '+p.name,
 'metadata[order_id]':orderId,'metadata[user_id]':String(user.id),'metadata[product_id]':productId});
 if(user.stripe_customer_id)form.set('customer',user.stripe_customer_id);else form.set('customer_email',user.email);
 if(p.kind==='subscription'){
  form.set('line_items[0][price_data][recurring][interval]','month');
  form.set('subscription_data[metadata][user_id]',String(user.id));
  form.set('subscription_data[metadata][plan_id]',productId);
 }
 let result:any;
 try{result=await stripe(env,'checkout/sessions',form)}catch(e){await run(env,"UPDATE orders SET status='create_failed' WHERE id=?",orderId);throw e;}
 if(!result.url?.startsWith('https://checkout.stripe.com/'))fail(502,'付款页面 URL 无效');
 await run(env,'UPDATE orders SET checkout_id=? WHERE id=?',result.id,orderId);
 return {checkout_url:result.url};
}
export async function billingPortal(env:Env,user:any){
 if(!billingReady(env))fail(503,'Stripe 未配置');if(!user.stripe_customer_id)fail(400,'尚无 Stripe 付费账户');
 const f=new URLSearchParams({customer:user.stripe_customer_id,return_url:(env.WEB_BASE_URL||'https://trendmint.fategenie.com')+'/billing'});
 const r=await stripe(env,'billing_portal/sessions',f);
 if(!r.url?.startsWith('https://billing.stripe.com/'))fail(502,'返回的订阅管理地址无效');
 return {portal_url:r.url};
}
export async function verifyStripe(body:string,header:string,secret:string):Promise<any>{
 if(!secret)fail(503,'Stripe Webhook 未配置');
 const parts=Object.fromEntries(header.split(',').map(x=>x.trim().split('=',2)).filter(x=>x.length===2));
 const ts=Number(parts.t),signs=header.split(',').filter(x=>x.trim().startsWith('v1=')).map(x=>x.trim().slice(3));
 if(!Number.isSafeInteger(ts)||Math.abs(Date.now()/1000-ts)>300||!signs.length)fail(400,'Stripe 签名时间戳不合法');
 const expected=await stripeHmac(ts+'.'+body,secret);
 if(!signs.some(x=>timingSafe(x,expected)))fail(400,'Stripe 签名不匹配');
 let event:any;try{event=JSON.parse(body)}catch{fail(400,'Stripe 数据无法解析')}
 if(typeof event.id!=='string'||typeof event.type!=='string')fail(400,'Stripe 事件缺少 ID');
 return event;
}
async function upsertSubscription(env:Env,subId:string,userId:number,planId:string,status:string){
 await run(env,`INSERT INTO subscriptions(stripe_id,user_id,plan_id,status) VALUES(?,?,?,?)
  ON CONFLICT(stripe_id) DO UPDATE SET status=excluded.status,plan_id=excluded.plan_id`,subId,userId,planId,status);
}
function invoiceSub(i:any):string|null{
 const x=i.subscription||i.parent?.subscription_details?.subscription||i.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
 return typeof x==='string'&&x.startsWith('sub_')?x:null;
}
export async function handleStripeEvent(env:Env,event:any){
 const eventId=event.id,kind=event.type,obj=event.data?.object||{};
 if(await one(env,'SELECT id FROM stripe_events WHERE id=?',eventId))return 'duplicate';
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(kind)&&obj.payment_status==='paid'){
  const o=await one(env,'SELECT * FROM orders WHERE id=?',obj.metadata?.order_id||'');
  if(o&&o.checkout_id===obj.id&&o.user_id===Number(obj.metadata?.user_id)&&o.product_id===obj.metadata?.product_id
   &&String(obj.currency||'').toLowerCase()==='usd'&&Number(obj.amount_total)===o.amount_cents){
    if(typeof obj.customer==='string'&&obj.customer.startsWith('cus_'))await run(env,'UPDATE users SET stripe_customer_id=? WHERE id=? AND (stripe_customer_id IS NULL OR stripe_customer_id=?)',obj.customer,o.user_id,obj.customer);
    if(o.kind==='pack'&&obj.mode==='payment'){
     await moveCredits(env,o.user_id,o.credits,'积分包付款',`order:${o.id}`);
     await run(env,"UPDATE orders SET status='paid',paid_at=? WHERE id=?",now(),o.id);
     await run(env,"INSERT OR IGNORE INTO revenue_events(user_id,cents,kind,ref) VALUES(?,?,'pack',?)",o.user_id,o.amount_cents,`order:${o.id}`);
    }else if(o.kind==='subscription'&&obj.mode==='subscription'&&typeof obj.subscription==='string'){
     await upsertSubscription(env,obj.subscription,o.user_id,o.product_id,'active');
     await run(env,"UPDATE orders SET status='paid',paid_at=? WHERE id=?",now(),o.id);
    }
  }
 }else if(kind==='invoice.paid'&&obj.paid===true&&Number(obj.amount_paid)>0){
  const subId=invoiceSub(obj),invoiceId=obj.id;
  let sub=subId?await one(env,'SELECT * FROM subscriptions WHERE stripe_id=?',subId):null;
  if(!sub&&subId){
   const remote=await stripe(env,'subscriptions/'+encodeURIComponent(subId));const uid=Number(remote.metadata?.user_id),plan=remote.metadata?.plan_id;
   if(uid&&PACKS[plan]?.kind==='subscription'&&await one(env,'SELECT id FROM users WHERE id=?',uid)){
     await upsertSubscription(env,subId,uid,plan,remote.status||'active');sub=await one(env,'SELECT * FROM subscriptions WHERE stripe_id=?',subId);
   }
  }
  if(sub&&PACKS[sub.plan_id]?.kind==='subscription'&&invoiceId){
   const ref='invoice:'+invoiceId;
   const already=await one(env,'SELECT id FROM revenue_events WHERE ref=?',ref);
   if(!already){
    await moveCredits(env,sub.user_id,PACKS[sub.plan_id].credits,'订阅月度积分',ref);
    await run(env,"INSERT OR IGNORE INTO revenue_events(user_id,cents,kind,ref) VALUES(?,?,'subscription',?)",sub.user_id,Number(obj.amount_paid),ref);
    await run(env,"UPDATE subscriptions SET status='active' WHERE stripe_id=?",subId);
   }
  }
 }else if(['customer.subscription.updated','customer.subscription.deleted'].includes(kind)){
  if(typeof obj.id==='string')await run(env,'UPDATE subscriptions SET status=? WHERE stripe_id=?',String(obj.status||'canceled'),obj.id);
 }else if(kind==='invoice.payment_failed'){
  const s=invoiceSub(obj);if(s)await run(env,"UPDATE subscriptions SET status='past_due' WHERE stripe_id=?",s);
 }
 await run(env,'INSERT OR IGNORE INTO stripe_events(id,type) VALUES(?,?)',eventId,kind);
 return 'processed';
}
export async function wallet(env:Env,user:any){
 const balance=(await one(env,'SELECT credits FROM users WHERE id=?',user.id))?.credits||0;
 const ledger=await all(env,'SELECT id,delta,balance_after AS balance,reason,created_at FROM credit_entries WHERE user_id=? ORDER BY id DESC LIMIT 25',user.id);
 const orders=await all(env,`SELECT id,product_id,amount_cents/100.0 AS amount_usd,status,kind,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 10`,user.id);
 const subscriptions=await all(env,'SELECT plan_id,status FROM subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 5',user.id);
 return {balance,ledger,orders,subscriptions};
}
