import asyncio
from datetime import datetime, timedelta, timezone

from audit import log_audit
from config import settings
from database import SessionLocal
from models import JobAttemptModel, JobModel, WorkerModel
from redis_service import redis_service
from schemas import job_to_dict, worker_to_dict


class HeartbeatReaperDaemon:
    def __init__(self, sio=None):
        self.sio = sio
        self.is_running = False
        self.last_sweep_timestamp = datetime.now(timezone.utc)

    def set_sio(self, sio):
        self.sio = sio

    def is_healthy(self) -> bool:
        delta = (datetime.now(timezone.utc) - self.last_sweep_timestamp).total_seconds() * 1000
        return delta < (settings.REAPER_INTERVAL_MS * 3)

    async def start(self):
        self.is_running = True
        print(f"[Reaper] Liveness daemon active (interval={settings.REAPER_INTERVAL_MS}ms, timeout={settings.MISSED_HEARTBEAT_THRESHOLD_MS}ms)")
        while self.is_running:
            try:
                await self.sweep()
            except Exception as e:
                print(f"[Reaper] Sweep error: {e}")
            await asyncio.sleep(settings.REAPER_INTERVAL_MS / 1000.0)

    async def sweep(self):
        self.last_sweep_timestamp = datetime.now(timezone.utc)

        # Promote any due delayed jobs (initial delayMs + exponential backoff retries)
        redis_service.promote_delayed()

        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            threshold = now - timedelta(milliseconds=settings.MISSED_HEARTBEAT_THRESHOLD_MS)

            # "killed" workers (from a manual chaos kill) also need reaping - the
            # kill endpoint sets status='killed' immediately for UI feedback, but
            # job reassignment still only happens here, via the stale heartbeat.
            dead_workers = db.query(WorkerModel).filter(
                WorkerModel.status.in_(["online", "degraded", "killed"]),
                WorkerModel.last_heartbeat < threshold
            ).all()

            for w in dead_workers:
                cause = "was manually killed" if w.status == "killed" else "crashed (missed heartbeats)"
                print(f"[Reaper] Worker {w.hostname} (PID {w.pid}) {cause}. Marking DEAD.")
                w.status = "dead"
                stale_job_id = w.current_job_id
                w.current_job_id = None
                w.current_job_type = None
                w.current_job_progress = 0
                db.commit()

                if self.sio:
                    await self.sio.emit("worker:status", {"id": w.id, "status": "dead", "hostname": w.hostname})
                    await self.sio.emit("workers:update", [worker_to_dict(x) for x in db.query(WorkerModel).all()])

                if stale_job_id:
                    job = db.query(JobModel).filter(JobModel.id == stale_job_id).first()
                    if job and job.status not in ("completed", "dead", "cancelled"):
                        job.attempts += 1
                        new_epoch = redis_service.bump_lease_epoch(job.id)
                        job.lease_epoch = new_epoch

                        # Monotonic, never-reset attempt number - see worker_process.py
                        # for why this must not just be job.attempts (retries reset that).
                        attempt_number = db.query(JobAttemptModel).filter(JobAttemptModel.job_id == job.id).count() + 1
                        attempt = JobAttemptModel(
                            job_id=job.id,
                            worker_id=w.id,
                            worker_pid=w.pid,
                            attempt_number=attempt_number,
                            started_at=now,
                            ended_at=now,
                            status="worker_killed",
                            error_code="HEARTBEAT_TIMEOUT",
                            error_message=f"Worker PID {w.pid} stopped sending heartbeats mid-execution. Recovered by Heartbeat Reaper."
                        )
                        db.add(attempt)

                        if job.attempts >= job.max_attempts:
                            job.status = "dead"
                            job.worker_id = None
                            job.progress = 0
                            log_audit(db, "JOB_DEAD_LETTERED", {
                                "jobId": job.id, "type": job.type,
                                "reason": "worker_crash_exhausted_retries",
                            })
                        else:
                            job.status = "pending"
                            job.worker_id = None
                            job.progress = 0
                            # Prepend to the head of its priority bucket so failed-over
                            # jobs don't starve behind the rest of the queue.
                            redis_service.enqueue_job(job.id, priority=job.priority, head=True)
                            log_audit(db, "JOB_AUTO_REASSIGNED", {
                                "jobId": job.id, "previousWorkerId": w.id, "pid": w.pid,
                            })

                        db.commit()

                        if self.sio:
                            await self.sio.emit("job:reassigned", {
                                "jobId": job.id,
                                "previousWorkerId": w.id,
                                "reason": f"Worker PID {w.pid} {cause}. Autonomous failover executed."
                            })
                            await self.sio.emit("job:updated", job_to_dict(job))
                            await self.sio.emit("log:stream", {
                                "timestamp": now.isoformat(),
                                "level": "warn",
                                "source": "Reaper",
                                "message": (
                                    f"Worker {w.hostname} (PID {w.pid}) missed heartbeat - "
                                    f"job {job.id[:8]} reassigned (epoch bumped to {new_epoch})."
                                ),
                            })
        finally:
            db.close()


reaper_daemon = HeartbeatReaperDaemon()
