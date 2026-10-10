import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Order, RevenueEvent, CreditEntry, Trend, User
from app.wallet import adjust_credits, InsufficientCredits
from app.payments import verify_signature, process_stripe_event
from app.trends import score_trend, track_keyword, valid_source_url
from app.worker import process_one
import pytest


def test_health_and_templates(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["mode"] == "demo"
    templates = client.get("/api/public/templates").json()
    assert len(templates) >= 4
    assert templates[0]["credits"] == 6
    assert client.get("/api/public/templates/pet-popstar").status_code == 200
    assert "Pet Popstar" in client.get("/t/pet-popstar").text


def test_auth_user_cannot_self_promote(client):
    email = "member-" + uuid.uuid4().hex[:8] + "@example.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "safe-pass123"})
    assert r.status_code == 200
    assert r.json()["is_admin"] is False
    assert r.json()["credits"] == 12
    assert client.get("/api/admin/trends").status_code == 403
    assert client.post("/api/admin/trends", json={"title":"Foo", "keyword":"foo foo foo"}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token":client.cookies["tm_csrf"]}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_protected_routes_require_auth(client):
    assert client.get("/api/jobs").status_code == 401
    assert client.get("/api/wallet").status_code == 401
    assert client.get("/api/admin/overview").status_code == 401


def test_trends_and_review(demo):
    c,h=demo
    trends = c.get("/api/admin/trends").json()
    assert len(trends) == 5
    assert all(t["is_sample"] and t["growth_pct"] is None for t in trends)
    assert c.post("/api/admin/collect",headers=h).status_code == 503
    title="Manual Idea " + uuid.uuid4().hex[:6]
    created=c.post("/api/admin/trends",headers=h,json={"title":title,"keyword":title.lower(),"source_url":"https://example.org/idea"})
    assert created.status_code == 200
    trend_id=created.json()["id"]
    updated=c.patch(f"/api/admin/trends/{trend_id}",headers=h,json={"demand":5,"willingness":4,"opportunity":3,"feasibility":4,"compliance":5,"stage":"测试中","notes":"validation planned"})
    assert updated.status_code == 200
    assert updated.json()["demand"] == 5
    assert updated.json()["stage"] == "测试中"
    assert c.get(f"/api/admin/trends/{trend_id}/evidence").json() == []
    assert c.post("/api/admin/trends",headers=h,json={"title":title,"keyword":title.lower()}).status_code == 409
    assert not valid_source_url("javascript:alert(1)")


def test_job_deduct_and_demo_mp4(demo,sample_image):
    c,h=demo
    before=c.get("/api/wallet").json()["balance"]
    files={"image":("source.jpg",sample_image,"image/jpeg")}
    no_rights=c.post("/api/jobs",headers=h,files=files,data={"template_id":"1","agree_rights":"false"})
    assert no_rights.status_code == 422
    created=c.post("/api/jobs",headers=h,files=files,data={"template_id":"1","agree_rights":"true"})
    assert created.status_code == 200, created.text
    job_id=created.json()["id"]
    assert c.get("/api/wallet").json()["balance"] == before - 6
    assert process_one()
    detail=c.get("/api/jobs/"+job_id).json()
    assert detail["status"] == "completed"
    output=c.get("/api/jobs/"+job_id+"/download")
    assert output.status_code == 200
    assert output.headers["content-type"].startswith("video/mp4")
    assert b"ftyp" in output.content[:80]
    assert c.get("/api/admin/overview").json()["revenue_usd"] == 0


def test_failure_refunds_exactly_once(demo,sample_image,monkeypatch):
    import app.worker as w
    c,h=demo
    before=c.get("/api/wallet").json()["balance"]
    created=c.post("/api/jobs",headers=h,files={"image":("p.jpg",sample_image,"image/jpeg")},data={"template_id":"1","agree_rights":"true"})
    assert created.status_code == 200
    def fail(*_args):
        raise RuntimeError("test failure")
    monkeypatch.setattr(w,"render_demo_video",fail)
    assert process_one()
    job=c.get("/api/jobs/"+created.json()["id"]).json()
    assert job["status"]=="failed"
    assert c.get("/api/wallet").json()["balance"] == before
    with SessionLocal() as db:
        refs=db.scalars(select(CreditEntry.ref).where(CreditEntry.ref=="job:"+job["id"]+":refund")).all()
        assert len(refs)==1
    assert process_one() is False


def test_bad_image_and_insufficient_credits(client,sample_image):
    email="empty-"+uuid.uuid4().hex[:8]+"@example.com"
    user=client.post("/api/auth/register",json={"email":email,"password":"test-password-123"}).json()
    token={"X-CSRF-Token":client.cookies["tm_csrf"]}
    invalid=client.post("/api/jobs",headers=token,files={"image":("evil.jpg",b"<script>x</script>","image/jpeg")},data={"template_id":"1","agree_rights":"true"})
    assert invalid.status_code==422
    with SessionLocal() as db:
        db.get(User,user["id"]).credits=0
        db.commit()
    insufficient=client.post("/api/jobs",headers=token,files={"image":("p.jpg",sample_image,"image/jpeg")},data={"template_id":"1","agree_rights":"true"})
    assert insufficient.status_code==402


def test_wallet_reference_idempotency(client):
    email="wallet-"+uuid.uuid4().hex[:8]+"@example.com"
    user=client.post("/api/auth/register",json={"email":email,"password":"test-password-123"}).json()
    with SessionLocal() as db:
        assert adjust_credits(db,user["id"],7,"bonus","test:"+email)
        db.commit()
        assert not adjust_credits(db,user["id"],7,"bonus","test:"+email)
        db.commit()
        assert db.get(User,user["id"]).credits==19
        with pytest.raises(InsufficientCredits):
            adjust_credits(db,user["id"],-20,"bad","test:overspend:"+email)
        db.rollback()


def test_stripe_signature_and_idempotent_payment(demo):
    c,_=demo
    now_ts=1730000000
    event={"id":"evt_"+uuid.uuid4().hex,"type":"checkout.session.completed","data":{"object":{"mode":"payment","payment_status":"paid","metadata":{}}}}
    blob=json.dumps(event).encode()
    secret="whsec_test"
    sig=hmac.new(secret.encode(),f"{now_ts}.".encode()+blob,hashlib.sha256).hexdigest()
    assert verify_signature(blob,f"t={now_ts},v1={sig}",secret,timestamp=now_ts)==event
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        verify_signature(blob,f"t={now_ts},v1=invalid",secret,timestamp=now_ts)
    with pytest.raises(HTTPException):
        verify_signature(blob,f"t={now_ts},v1={sig}",secret,timestamp=now_ts+400)
    with SessionLocal() as db:
        user=db.scalar(select(User).where(User.email=="demo@trendmint.local"))
        order=Order(id="ord_"+uuid.uuid4().hex[:24],user_id=user.id,product_id="spark",amount_cents=490,credits=20,kind="pack")
        db.add(order);db.commit()
        event["data"]["object"]["metadata"]={"order_id":order.id,"user_id":str(user.id)}
        old=user.credits
        assert process_stripe_event(db,event)=="processed"
        assert process_stripe_event(db,event)=="duplicate"
        db.refresh(user)
        assert user.credits==old+20
        payments=db.scalars(select(RevenueEvent).where(RevenueEvent.ref=="order:"+order.id)).all()
        assert len(payments)==1 and payments[0].cents==490


def test_trend_repeat_sample_baseline(client):
    first=datetime(2026,10,10,4,0,tzinfo=timezone.utc)
    with SessionLocal() as db:
        t=Trend(title="Repeat Test",keyword="repeat-"+uuid.uuid4().hex[:8])
        db.add(t);db.flush()
        clip={"id":"yt-test-"+uuid.uuid4().hex[:8],"title":"AI new trend","views":1000,"url":"https://www.youtube.com/watch?v=abcd"}
        track_keyword(db,t,[clip],first);db.commit()
        assert t.growth_pct is None
        updated={**clip,"views":1300}
        track_keyword(db,t,[updated],first+timedelta(hours=5));db.commit()
        assert t.delta_views==300
        assert t.growth_pct==30.0
        assert 0<=score_trend(t)<=100


def test_demo_topup_not_revenue(demo):
    c,h=demo
    r=c.post('/api/billing/demo-topup',headers=h)
    assert r.status_code==200 and r.json()['demo_only']
    assert c.get('/api/admin/overview').json()['revenue_usd']>=0


def test_payments_require_config(demo):
    c,h=demo
    r=c.post('/api/billing/checkout',headers=h,json={'product_id':'spark'})
    assert r.status_code==503
    assert c.post('/api/billing/portal',headers=h).status_code==503


def test_subscription_same_invoice_different_events_granted_once(demo):
    from app.models import Subscription
    client, _ = demo
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "demo@trendmint.local"))
        before = user.credits
        sub_id = "sub_" + uuid.uuid4().hex
        invoice_id = "in_" + uuid.uuid4().hex
        db.add(Subscription(user_id=user.id, plan_id="monthly_basic", stripe_id=sub_id, status="active"))
        db.commit()
        def event():
            return {"id": "evt_" + uuid.uuid4().hex, "type": "invoice.paid",
                    "data": {"object": {"id": invoice_id, "subscription": sub_id,
                                        "paid": True, "amount_paid": 990}}}
        assert process_stripe_event(db, event()) == "processed"
        assert process_stripe_event(db, event()) == "processed"  # event ID differs
        db.refresh(user)
        assert user.credits == before + 50
        assert len(db.scalars(select(RevenueEvent).where(RevenueEvent.ref == "invoice:" + invoice_id)).all()) == 1


def test_subscription_invoice_no_payment_no_free_credits(demo):
    from app.models import Subscription
    client, _ = demo
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "demo@trendmint.local"))
        before = user.credits
        sub_id = "sub_" + uuid.uuid4().hex
        db.add(Subscription(user_id=user.id, plan_id="monthly_basic", stripe_id=sub_id, status="active"))
        db.commit()
        event = {"id": "evt_" + uuid.uuid4().hex, "type": "invoice.paid",
                 "data": {"object": {"id": "in_" + uuid.uuid4().hex,
                                     "subscription": sub_id, "paid": True, "amount_paid": 0}}}
        assert process_stripe_event(db, event) == "processed"
        db.refresh(user)
        assert user.credits == before


def test_local_video_cleanup(demo, sample_image):
    from app.worker import purge_expired_local_files
    from app.config import settings
    from app.models import Job
    from pathlib import Path
    c,h = demo
    created = c.post("/api/jobs", headers=h,
                     files={"image": ("p.jpg", sample_image, "image/jpeg")},
                     data={"template_id": "1", "agree_rights": "true"})
    assert created.status_code == 200
    job_id = created.json()["id"]
    assert process_one()
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        assert not Path(job.input_path).exists(), "source photo should be deleted promptly"
        output = Path(job.output_path)
        assert output.exists()
        job.completed_at = datetime.now(timezone.utc) - timedelta(days=settings.retention_days + 1)
        db.commit()
    purge_expired_local_files()
    assert not output.exists()
    assert c.get(f"/api/jobs/{job_id}/download").status_code == 410
    assert c.get(f"/api/jobs/{job_id}").json()["download_url"] is None


def test_template_factory_admin_create_and_hide(demo):
    c,h = demo
    slug = 'video-launch-' + uuid.uuid4().hex[:8]
    data = {
        'slug': slug, 'title': '新特效玩法', 'title_en': 'Original Video Effect',
        'description': '用授权照片制作一段原创视频效果',
        'description_en': 'Create an original video from a photo you have rights to.',
        'prompt': 'Make a playful original video of the provided subject on a sunny background, slow camera dolly.',
        'emoji': '🦊', 'tag': '新上线', 'credits': 8,
    }
    created=c.post('/api/admin/templates',headers=h,json=data)
    assert created.status_code == 200,created.text
    template_id=created.json()['id']
    assert c.get('/api/public/templates/'+slug).status_code == 200
    assert 'Original Video Effect' in c.get('/t/'+slug).text
    assert 'canonical' in c.get('/t/'+slug).text
    assert c.post('/api/admin/templates',headers=h,json=data).status_code == 409
    updated=c.patch('/api/admin/templates/'+str(template_id),headers=h,json={'active':False})
    assert updated.status_code == 200 and not updated.json()['active']
    assert c.get('/api/public/templates/'+slug).status_code == 404
    assert c.get('/api/admin/templates').status_code == 200
    with SessionLocal() as db:
        assert db.get(User, 1)


def test_admin_download_report_and_nonadmin_denied(demo):
    c,h=demo
    report=c.get('/api/admin/report')
    assert report.status_code == 200
    assert '# TrendMint 机会日报' in report.text
    assert '演示样例' in report.text
    assert 'text/markdown' in report.headers.get('content-type','')
    c.post('/api/auth/logout',headers=h)
    assert c.get('/api/admin/report').status_code == 401


def test_fal_queue_protocol_mocked(tmp_path, sample_image, monkeypatch):
    """Checks request shape and queue response handling without real API credentials."""
    import app.video as v
    import httpx
    from types import SimpleNamespace
    path = tmp_path / 'reference.jpg'
    path.write_bytes(sample_image)
    monkeypatch.setattr(v, 'settings', SimpleNamespace(fal_key='test-key',
                            fal_model_id='fal-ai/kling-video/v2.5-turbo/standard/image-to-video'))
    monkeypatch.setattr(v.time, 'sleep', lambda _n: None)
    seen = {}
    def respond(req):
        if req.method == 'POST':
            body = json.loads(req.content)
            seen.update(body)
            return httpx.Response(200,json={'request_id':'abc123'})
        if req.url.path.endswith('/status'):
            return httpx.Response(200,json={'status':'COMPLETED'})
        return httpx.Response(200,json={'video':{'url':'https://example.org/authorized-test.mp4'}})
    transport = httpx.MockTransport(respond)
    original_client = httpx.Client
    monkeypatch.setattr(v.httpx, 'Client', lambda **kwargs: original_client(transport=transport,**kwargs))
    url, req_id = v.fal_generate_video(path, 'Original sample motion scene')
    assert url == 'https://example.org/authorized-test.mp4'
    assert req_id == 'abc123'
    assert seen['image_url'].startswith('data:image/jpeg;base64,')
    assert seen['duration'] == '5'


def test_youtube_collector_request_shape_with_mock():
    import app.trends as trends
    import httpx
    seen=[]
    def respond(req):
        seen.append((req.url.path, str(req.url)))
        if req.url.path.endswith('/search'):
            return httpx.Response(200,json={'items':[{'id':{'videoId':'abc123'}}]})
        return httpx.Response(200,json={'items':[{'id':'abc123','snippet':{
            'title':'Original AI effect','publishedAt':'2026-10-10T08:00:00Z'},
            'statistics':{'viewCount':'12400'}}]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        items=trends.youtube_search(client,'fake-test-key','new ai effect',datetime(2026,10,3,tzinfo=timezone.utc))
    assert len(items)==1
    assert items[0]['views']==12400
    assert items[0]['url']=='https://www.youtube.com/watch?v=abc123'
    assert len(seen)==2
    assert any('/youtube/v3/videos' in x[0] for x in seen)
