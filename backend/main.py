import sys

if sys.platform == "win32":
    # Prevents UnicodeEncodeError crashes on Windows consoles (cp1252) when
    # log lines contain non-ASCII characters.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import socketio

from audit import log_audit
from auth import create_token, get_current_user, require_admin
from config import settings
from database import init_db, get_db, SessionLocal
from models import JobModel, JobAttemptModel, WorkerModel, AuditLogModel
from process_manager import process_manager
from redis_service import redis_service
from reaper import reaper_daemon
from schemas import job_to_dict, attempt_to_dict, worker_to_dict, audit_to_dict
from seed import seed_database
from sqlalchemy.orm import Session


# Setup Socket.IO ASGI App
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
fastapi_app = FastAPI(
    title="PulseQueue Engine (FastAPI + PostgreSQL)",
    description="High-Throughput Asynchronous Task Scheduler with Autonomous Failover & Real-Time Telemetry",
    version="1.0.0"
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

reaper_daemon.set_sio(sio)

# ─── Pydantic Schemas ────────────────────────────────────────

class JobCreate(BaseModel):
    type: str
    payload: Dict[str, Any]
    priority: Optional[int] = 5
    maxAttempts: Optional[int] = 3
    backoffMs: Optional[int] = 2000
    delayMs: Optional[int] = 0

class BatchJobCreate(BaseModel):
    count: Optional[int] = 10
    type: Optional[str] = "data_sync"

class DemoLogin(BaseModel):
    role: Optional[str] = "admin"

class GoogleLogin(BaseModel):
    sub: Optional[str] = None
    name: Optional[str] = "Google User"
    email: str
    picture: Optional[str] = None

class WorkerSpawn(BaseModel):
    hostname: Optional[str] = None
    concurrency: Optional[int] = 1


# ─── Metrics helper (shared by REST + socket connect + broadcast) ──

def compute_metrics(db: Session) -> dict:
    total = db.query(JobModel).count()
    pending = db.query(JobModel).filter(JobModel.status == "pending").count()
    active = db.query(JobModel).filter(JobModel.status == "active").count()
    completed = db.query(JobModel).filter(JobModel.status == "completed").count()
    failed = db.query(JobModel).filter(JobModel.status == "failed").count()
    dead = db.query(JobModel).filter(JobModel.status == "dead").count()
    delayed = db.query(JobModel).filter(JobModel.status == "delayed").count()

    workers = db.query(WorkerModel).all()
    online_workers = sum(1 for w in workers if w.status == "online")

    completed_attempts = (
        db.query(JobAttemptModel)
        .filter(JobAttemptModel.status == "completed", JobAttemptModel.duration_ms.isnot(None))
        .all()
    )
    avg_duration = (
        int(sum(a.duration_ms for a in completed_attempts) / len(completed_attempts))
        if completed_attempts else 0
    )

    return {
        "totalJobs": total,
        "pendingJobs": pending,
        "activeJobs": active,
        "completedJobs": completed,
        "failedJobs": failed,
        "deadJobs": dead,
        "delayedJobs": delayed,
        "onlineWorkers": online_workers,
        "totalWorkers": len(workers),
        "throughputPerMin": completed,
        "avgDurationMs": avg_duration,
        "atLeastOnceRecoveries": db.query(JobAttemptModel).filter(JobAttemptModel.status == "worker_killed").count()
    }


# ─── Auth Endpoints ──────────────────────────────────────────

@fastapi_app.post("/api/auth/demo")
def demo_login(data: DemoLogin, db: Session = Depends(get_db)):
    role = data.role if data.role in ("admin", "viewer") else "admin"
    user_id = f"usr-{role}-evaluator"
    name = "Judge Evaluator (Admin)" if role == "admin" else "Demo Visitor (Viewer)"
    email = f"{role}@synora.internal"

    log_audit(db, "USER_LOGIN_DEMO", {"name": name, "role": role})
    db.commit()

    token = create_token(user_id, role, name, email)
    return {
        "user": {
            "id": user_id,
            "name": name,
            "email": email,
            "avatarUrl": f"https://api.dicebear.com/7.x/bottts/svg?seed={role}&backgroundColor=0284c7",
            "role": role
        },
        "token": token
    }

@fastapi_app.post("/api/auth/google")
def google_login(data: GoogleLogin, db: Session = Depends(get_db)):
    user_id = data.sub or str(uuid.uuid4())

    log_audit(db, "USER_LOGIN_GOOGLE", {"email": data.email, "name": data.name})
    db.commit()

    token = create_token(user_id, "admin", data.name or "Google User", data.email)
    return {
        "user": {
            "id": user_id,
            "name": data.name,
            "email": data.email,
            "avatarUrl": data.picture or "https://api.dicebear.com/7.x/bottts/svg?seed=GoogleUser",
            "role": "admin"
        },
        "token": token
    }

# ─── Metrics Endpoint ────────────────────────────────────────

@fastapi_app.get("/api/metrics")
def get_metrics(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return compute_metrics(db)

# ─── Health Probe ────────────────────────────────────────────

@fastapi_app.get("/health/liveness")
def health_liveness():
    if reaper_daemon.is_healthy():
        return {"status": "ok", "engine": "FastAPI", "reaper": "active"}
    raise HTTPException(status_code=503, detail="Reaper watchdog stalled")

# ─── Jobs Endpoints ──────────────────────────────────────────

@fastapi_app.get("/api/jobs")
def list_jobs(
    status: Optional[str] = None,
    type: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    query = db.query(JobModel)
    if status and status != "all":
        query = query.filter(JobModel.status == status)
    if type and type != "all":
        query = query.filter(JobModel.type == type)
    jobs = [job_to_dict(j) for j in query.order_by(JobModel.created_at.desc()).all()]

    if search:
        needle = search.lower()
        jobs = [
            j for j in jobs
            if needle in j["id"].lower()
            or needle in j["type"].lower()
            or needle in json.dumps(j["payload"]).lower()
        ]

    return jobs

@fastapi_app.get("/api/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    job = db.query(JobModel).filter(JobModel.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    attempts = (
        db.query(JobAttemptModel)
        .filter(JobAttemptModel.job_id == job_id)
        .order_by(JobAttemptModel.attempt_number)
        .all()
    )
    return {"job": job_to_dict(job), "attempts": [attempt_to_dict(a) for a in attempts]}

@fastapi_app.post("/api/jobs", status_code=201)
async def create_job(data: JobCreate, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    job_id = str(uuid.uuid4())
    delay_ms = data.delayMs or 0
    job = JobModel(
        id=job_id,
        type=data.type,
        payload=data.payload,
        status="delayed" if delay_ms > 0 else "pending",
        priority=data.priority,
        max_attempts=data.maxAttempts,
        backoff_ms=data.backoffMs
    )
    db.add(job)
    log_audit(db, "JOB_ENQUEUED", {"jobId": job_id, "type": data.type, "priority": data.priority})
    db.commit()

    redis_service.enqueue_job(job_id, priority=data.priority, delay_ms=delay_ms)

    out = job_to_dict(job)
    await sio.emit("job:created", out)
    return out

@fastapi_app.post("/api/jobs/batch", status_code=201)
async def create_batch_jobs(data: BatchJobCreate, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    count = data.count or 5
    job_type = data.type or "data_sync"
    created = []

    for i in range(count):
        job_id = str(uuid.uuid4())
        payload = {
            "taskName": f"Batch Processing Job #{i+1}",
            "itemsCount": 1000 + (i * 100),
            "sleepMs": 100
        }
        job = JobModel(
            id=job_id,
            type=job_type,
            payload=payload,
            status="pending",
            priority=5
        )
        db.add(job)
        created.append(job)

    log_audit(db, "JOB_BATCH_ENQUEUED", {"count": count, "type": job_type})
    db.commit()

    out = []
    for job in created:
        redis_service.enqueue_job(job.id, priority=job.priority)
        job_dict = job_to_dict(job)
        out.append(job_dict)
        await sio.emit("job:created", job_dict)

    return out

@fastapi_app.post("/api/jobs/{job_id}/retry")
async def retry_job(job_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    job = db.query(JobModel).filter(JobModel.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("dead", "failed"):
        raise HTTPException(status_code=400, detail="Only failed or dead-lettered jobs can be retried")

    redis_service.remove_from_queues(job.id)
    redis_service.clear_epoch(job.id)

    job.status = "pending"
    job.attempts = 0
    job.worker_id = None
    job.progress = 0
    job.result = None

    log_audit(db, "JOB_MANUAL_RETRY", {"jobId": job.id, "type": job.type, "operator": user.get("name")})
    db.commit()

    redis_service.enqueue_job(job.id, priority=job.priority, head=True)

    out = job_to_dict(job)
    await sio.emit("job:updated", out)
    await sio.emit("log:stream", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": "info",
        "source": "Operator",
        "message": f"Job {job.id[:8]} manually retried by {user.get('name')}."
    })
    return out

@fastapi_app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    job = db.query(JobModel).filter(JobModel.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("pending", "delayed"):
        raise HTTPException(status_code=400, detail="Only pending or delayed jobs can be cancelled")

    redis_service.remove_from_queues(job.id)
    job.status = "cancelled"

    log_audit(db, "JOB_CANCELLED", {"jobId": job.id, "type": job.type, "operator": user.get("name")})
    db.commit()

    out = job_to_dict(job)
    await sio.emit("job:updated", out)
    return {"success": True, "job": out}

@fastapi_app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    return await cancel_job(job_id, db, user)

# ─── Workers Endpoints ───────────────────────────────────────

@fastapi_app.get("/api/workers")
def list_workers(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return [worker_to_dict(w) for w in db.query(WorkerModel).all()]

@fastapi_app.post("/api/workers/spawn", status_code=201)
@fastapi_app.post("/api/workers", status_code=201)
async def spawn_worker(
    data: Optional[WorkerSpawn] = None,
    db: Session = Depends(get_db),
    user: dict = Depends(require_admin),
):
    worker_id = f"w-{uuid.uuid4().hex[:8]}"
    count = db.query(WorkerModel).count() + 1
    hostname = data.hostname if (data and data.hostname) else f"worker-node-{count}"
    concurrency = data.concurrency if (data and data.concurrency) else 1

    worker = WorkerModel(
        id=worker_id,
        pid=0,
        hostname=hostname,
        status="online",
        concurrency=concurrency,
        jobs_processed=0,
        jobs_failed=0,
        memory_mb=0,
        started_at=datetime.now(timezone.utc),
        last_heartbeat=datetime.now(timezone.utc)
    )
    db.add(worker)
    log_audit(db, "WORKER_SPAWNED", {"workerId": worker_id, "hostname": hostname})
    db.commit()

    pid = process_manager.spawn(worker_id, hostname)
    worker.pid = pid
    db.commit()

    all_workers = [worker_to_dict(w) for w in db.query(WorkerModel).all()]
    await sio.emit("workers:update", all_workers)
    await sio.emit("log:stream", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": "info",
        "source": "ProcessManager",
        "message": f"Spawned worker {hostname} (PID {pid})."
    })

    return {"id": worker_id, "pid": pid, "hostname": hostname, "status": "online"}

@fastapi_app.post("/api/workers/{worker_id}/kill")
async def kill_worker(worker_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    worker = db.query(WorkerModel).filter(WorkerModel.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    killed_pid = process_manager.kill(worker_id)
    pid = killed_pid if killed_pid is not None else worker.pid
    worker.status = "killed"

    log_audit(db, "WORKER_KILLED", {"workerId": worker_id, "hostname": worker.hostname, "pid": pid})
    db.commit()

    all_workers = [worker_to_dict(w) for w in db.query(WorkerModel).all()]
    await sio.emit("worker:killed", {"workerId": worker_id, "pid": pid, "reason": "Manual chaos kill via dashboard"})
    await sio.emit("workers:update", all_workers)
    await sio.emit("log:stream", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": "error",
        "source": "ChaosSwitch",
        "message": f"Worker {worker.hostname} (PID {pid}) forcefully terminated. Awaiting Reaper failover..."
    })
    return {"success": True, "pid": pid}

@fastapi_app.delete("/api/workers/{worker_id}")
async def delete_worker(worker_id: str, db: Session = Depends(get_db), user: dict = Depends(require_admin)):
    return await kill_worker(worker_id, db, user)

# ─── Audit Logs ──────────────────────────────────────────────

@fastapi_app.get("/api/audit-logs")
def get_audit_logs(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    logs = db.query(AuditLogModel).order_by(AuditLogModel.timestamp.desc()).limit(100).all()
    return [audit_to_dict(l) for l in logs]


# ─── System Reset & Seed ──────────────────────────────────────

@fastapi_app.post("/api/system/reset-and-seed")
async def reset_and_seed(db: Session = Depends(get_db)):
    """Wipes all previous data and reseeds fresh workers, workloads, and metrics."""
    seed_database(pm=process_manager)

    # Broadcast refreshed cluster state to all dashboards
    await sio.emit("metrics:update", compute_metrics(db))
    await sio.emit("workers:update", [worker_to_dict(w) for w in db.query(WorkerModel).all()])
    await sio.emit("log:stream", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": "info",
        "source": "SystemSeeder",
        "message": "Database and queues wiped and successfully reseeded with fresh telemetry data."
    })
    return {"success": True, "message": "Database and queues wiped and successfully reseeded."}

# ─── Socket.IO ────────────────────────────────────────────────

@sio.event
async def connect(sid, environ):
    print(f"[Socket] Client connected: {sid}")
    db = SessionLocal()
    try:
        await sio.emit("metrics:update", compute_metrics(db), to=sid)
        await sio.emit("workers:update", [worker_to_dict(w) for w in db.query(WorkerModel).all()], to=sid)
    finally:
        db.close()

@sio.event
def disconnect(sid):
    print(f"[Socket] Client disconnected: {sid}")

async def periodic_telemetry_broadcast():
    while True:
        await asyncio.sleep(2.0)
        db = SessionLocal()
        try:
            await sio.emit("metrics:update", compute_metrics(db))
            await sio.emit("workers:update", [worker_to_dict(w) for w in db.query(WorkerModel).all()])
        except Exception:
            pass
        finally:
            db.close()

async def redis_event_relay():
    """Relays events published by worker subprocesses (which have no direct
    handle to this process's Socket.IO server) out to connected dashboards."""
    import redis.asyncio as redis_asyncio

    if settings.REDIS_URL:
        client = redis_asyncio.from_url(
            settings.REDIS_URL, decode_responses=True, protocol=2
        )
    else:
        client = redis_asyncio.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True, protocol=2
        )
    pubsub = client.pubsub()
    await pubsub.subscribe(redis_service.EVENTS_CHANNEL)

    async for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        try:
            envelope = json.loads(message["data"])
            await sio.emit(envelope["event"], envelope["data"])
        except Exception:
            pass

# ─── Lifecycle & Startup ─────────────────────────────────────

async def _bootstrap_worker_fleet():
    db = SessionLocal()
    try:
        # Any worker row still marked online/degraded from a previous process
        # lifetime has no real OS process behind it anymore (process_manager's
        # in-memory PID map resets on every restart) - mark it dead immediately
        # instead of waiting 5.5s for the reaper to notice.
        stale = db.query(WorkerModel).filter(WorkerModel.status.in_(["online", "degraded"])).all()
        for w in stale:
            w.status = "dead"
        if stale:
            db.commit()

        for i in range(1, 4):
            worker_id = f"w-{uuid.uuid4().hex[:8]}"
            hostname = f"worker-node-{i}"
            worker = WorkerModel(
                id=worker_id,
                pid=0,
                hostname=hostname,
                status="online",
                concurrency=1,
                jobs_processed=0,
                jobs_failed=0,
                memory_mb=0,
                started_at=datetime.now(timezone.utc),
                last_heartbeat=datetime.now(timezone.utc),
            )
            db.add(worker)
            db.commit()
            pid = process_manager.spawn(worker_id, hostname)
            worker.pid = pid
            db.commit()
        print("[PulseQueue] Bootstrapped 3 worker node processes.")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern FastAPI lifespan handler (replaces deprecated on_event)."""
    # ── Startup ──
    init_db()
    asyncio.create_task(reaper_daemon.start())
    asyncio.create_task(periodic_telemetry_broadcast())
    asyncio.create_task(redis_event_relay())
    await _bootstrap_worker_fleet()
    print("[FastAPI Engine] Online at Port 4000 (Swagger docs at /docs)")

    yield  # ── App is running ──

    # ── Shutdown ──
    reaper_daemon.is_running = False
    process_manager.shutdown_all()
    print("[FastAPI Engine] Graceful shutdown complete.")


# Inject the lifespan into the FastAPI app
fastapi_app.router.lifespan_context = lifespan

# Combine FastAPI with Socket.IO ASGI app
app = socketio.ASGIApp(sio, fastapi_app)
