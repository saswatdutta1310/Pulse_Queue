import asyncio
from datetime import datetime, timedelta
from database import SessionLocal
from models import WorkerModel, JobModel, JobAttemptModel, AuditLogModel
from redis_service import redis_service
from config import settings

class HeartbeatReaperDaemon:
    def __init__(self, sio=None):
        self.sio = sio
        self.is_running = False
        self.last_sweep_timestamp = datetime.utcnow()

    def set_sio(self, sio):
        self.sio = sio

    def is_healthy(self) -> bool:
        delta = (datetime.utcnow() - self.last_sweep_timestamp).total_seconds() * 1000
        return delta < (settings.REAPER_INTERVAL_MS * 3)

    async def start(self):
        self.is_running = True
        print(f"🛡️ [Python Reaper] Liveness daemon active (Interval: {settings.REAPER_INTERVAL_MS}ms, Timeout: {settings.MISSED_HEARTBEAT_THRESHOLD_MS}ms)")
        while self.is_running:
            try:
                await self.sweep()
            except Exception as e:
                print(f"[Python Reaper] Sweep error: {e}")
            await asyncio.sleep(settings.REAPER_INTERVAL_MS / 1000.0)

    async def sweep(self):
        self.last_sweep_timestamp = datetime.utcnow()
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            threshold = now - timedelta(milliseconds=settings.MISSED_HEARTBEAT_THRESHOLD_MS)

            # Find dead workers
            dead_workers = db.query(WorkerModel).filter(
                WorkerModel.status.in_(["online", "degraded"]),
                WorkerModel.last_heartbeat < threshold
            ).all()

            for w in dead_workers:
                print(f"⚡ [Python Reaper] Worker {w.hostname} (PID: {w.pid}) missed heartbeats. Marking DEAD.")
                w.status = "dead"
                db.commit()

                # Reclaim job
                if w.current_job_id:
                    job = db.query(JobModel).filter(JobModel.id == w.current_job_id).first()
                    if job and job.status not in ["completed", "dead"]:
                        job.attempts += 1
                        new_epoch = redis_service.bump_lease_epoch(job.id)
                        job.lease_epoch = new_epoch

                        if job.attempts >= job.max_attempts:
                            job.status = "dead"
                            print(f"[Python Reaper] Job {job.id} exceeded max retries. Moved to DLQ.")
                        else:
                            job.status = "pending"
                            job.worker_id = None
                            job.progress = 0
                            # Re-queue
                            redis_service.enqueue_job(job.id, job.type, job.payload or {}, priority=job.priority)

                        # Record failed attempt
                        attempt = JobAttemptModel(
                            job_id=job.id,
                            worker_id=w.id,
                            worker_pid=w.pid,
                            attempt_number=job.attempts,
                            status="worker_killed",
                            error_code="HEARTBEAT_TIMEOUT",
                            error_message=f"Worker PID {w.pid} crashed mid-execution. Recovered by Python Reaper."
                        )
                        db.add(attempt)
                        db.commit()

                        # Broadcast socket alert if available
                        if self.sio:
                            await self.sio.emit("job:reassigned", {
                                "jobId": job.id,
                                "previousWorkerId": w.id,
                                "reason": f"Worker PID {w.pid} crashed. Autonomous failover executed."
                            })

                if self.sio:
                    await self.sio.emit("worker:status", {
                        "id": w.id,
                        "status": "dead",
                        "hostname": w.hostname
                    })
        finally:
            db.close()

reaper_daemon = HeartbeatReaperDaemon()
