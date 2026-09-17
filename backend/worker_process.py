"""
Standalone worker node. Spawned as a real OS child process by
process_manager.py, one per WorkerModel row. This is the piece that was
entirely missing from the original implementation: it actually dequeues
jobs from Redis, executes them, renews its own heartbeat, and respects
lease-epoch fencing so a job reclaimed by the Reaper mid-flight can't be
double-committed by this (now-zombie) process.

Run standalone: python worker_process.py --id <worker_id> --hostname <name>
"""
import argparse
import os
import sys
import threading
import time
from datetime import datetime, timezone

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audit import log_audit
from database import SessionLocal
from models import JobAttemptModel, JobModel, WorkerModel
from redis_service import redis_service
from schemas import job_to_dict

try:
    import psutil
except ImportError:
    psutil = None

HEARTBEAT_INTERVAL_SEC = 1.5
IDLE_POLL_SEC = 0.4
STEPS = 10


class WorkerProcess:
    def __init__(self, worker_id: str, hostname: str):
        self.worker_id = worker_id
        self.hostname = hostname
        self.pid = os.getpid()
        self._stop = threading.Event()

    # ─── Lifecycle ───────────────────────────────────────────────

    def register(self):
        db = SessionLocal()
        try:
            w = db.query(WorkerModel).filter(WorkerModel.id == self.worker_id).first()
            if w:
                w.pid = self.pid
                w.status = "online"
                w.started_at = datetime.now(timezone.utc)
                w.last_heartbeat = datetime.now(timezone.utc)
                w.current_job_id = None
                w.current_job_type = None
                w.current_job_progress = 0
                db.commit()
        finally:
            db.close()

    def heartbeat_loop(self):
        while not self._stop.is_set():
            db = SessionLocal()
            try:
                w = db.query(WorkerModel).filter(WorkerModel.id == self.worker_id).first()
                if not w or w.status == "killed":
                    self._stop.set()
                    break
                w.last_heartbeat = datetime.now(timezone.utc)
                if psutil:
                    try:
                        w.memory_mb = int(psutil.Process(self.pid).memory_info().rss / (1024 * 1024))
                    except Exception:
                        pass
                db.commit()
            except Exception:
                pass
            finally:
                db.close()
            time.sleep(HEARTBEAT_INTERVAL_SEC)

    def run(self):
        self.register()
        hb_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        hb_thread.start()

        print(f"[Worker {self.hostname}] online (pid={self.pid}), polling queue...")

        while not self._stop.is_set():
            processed_something = False
            db = SessionLocal()
            try:
                worker = db.query(WorkerModel).filter(WorkerModel.id == self.worker_id).first()
                if not worker or worker.status == "killed":
                    break

                job_id = redis_service.dequeue_job()
                if job_id:
                    job = db.query(JobModel).filter(JobModel.id == job_id).first()
                    if job and job.status not in ("completed", "dead", "cancelled"):
                        self._process_job(db, worker, job)
                        processed_something = True
            except Exception as e:
                print(f"[Worker {self.hostname}] loop error: {e}")
            finally:
                db.close()

            time.sleep(0.02 if processed_something else IDLE_POLL_SEC)

    # ─── Job execution ───────────────────────────────────────────

    def _process_job(self, db, worker: WorkerModel, job: JobModel):
        epoch = redis_service.claim_epoch(job.id)

        job.status = "active"
        job.worker_id = worker.id
        job.lease_epoch = epoch
        job.progress = 0
        worker.current_job_id = job.id
        worker.current_job_type = job.type
        worker.current_job_progress = 0

        # `retry_count` tracks the max_attempts budget for THIS retry cycle
        # (reset to 0 by a manual retry). `attempt_number` is a monotonic,
        # never-reset counter so the attempt audit trail stays chronological
        # and never collides across retry cycles.
        retry_count = job.attempts + 1
        attempt_number = db.query(JobAttemptModel).filter(JobAttemptModel.job_id == job.id).count() + 1
        attempt = JobAttemptModel(
            job_id=job.id,
            worker_id=worker.id,
            worker_pid=self.pid,
            attempt_number=attempt_number,
            started_at=datetime.now(timezone.utc),
            status="running",
        )
        db.add(attempt)
        db.commit()
        redis_service.publish_event("job:updated", job_to_dict(job))

        payload = job.payload or {}
        should_fail = bool(payload.get("shouldFail"))
        fail_at_percent = float(payload.get("failAtPercent", 50))
        failure_message = payload.get("failureMessage") or "Simulated task failure"
        sleep_ms = int(payload.get("sleepMs", 120))
        step_delay = max(0.03, sleep_ms / 1000.0)
        fail_at_step = max(1, min(STEPS, round(STEPS * (fail_at_percent / 100.0))))
        items = int(payload.get("itemsCount") or payload.get("complexity") or payload.get("records") or 100)

        started = time.time()
        error_info = None
        lease_lost = False

        for step in range(1, STEPS + 1):
            time.sleep(step_delay)

            if not redis_service.validate_lease_epoch(job.id, epoch):
                # The Reaper (or another worker) already reclaimed this job -
                # our completion/failure write would be a stale zombie commit.
                lease_lost = True
                break

            progress = int((step / STEPS) * 100)
            worker.current_job_progress = progress
            job.progress = progress
            try:
                db.commit()
            except Exception:
                db.rollback()

            if step % 5 == 0 or step == STEPS:
                redis_service.publish_event("job:updated", job_to_dict(job))

            if should_fail and step >= fail_at_step and error_info is None:
                error_info = failure_message
                break

        if lease_lost:
            print(f"[Worker {self.hostname}] lost lease on job {job.id[:8]} (epoch stale) - aborting silently")
            worker.current_job_id = None
            worker.current_job_type = None
            worker.current_job_progress = 0
            db.commit()
            return

        if not redis_service.validate_lease_epoch(job.id, epoch):
            worker.current_job_id = None
            worker.current_job_type = None
            worker.current_job_progress = 0
            db.commit()
            return

        duration_ms = int((time.time() - started) * 1000)

        if error_info:
            attempt.status = "failed"
            attempt.ended_at = datetime.now(timezone.utc)
            attempt.duration_ms = duration_ms
            attempt.error_code = "TASK_EXECUTION_FAILED"
            attempt.error_message = error_info
            attempt.stack_trace = (
                "Traceback (most recent call last):\n"
                f'  File "worker_process.py", line 1, in _process_job\n'
                f"    execute_handler(job_type=\"{job.type}\")\n"
                f"TaskExecutionError: {error_info}\n"
                f"  at worker={worker.hostname} pid={self.pid} attempt=#{attempt_number}"
            )

            job.attempts = retry_count
            worker.jobs_failed += 1

            if job.attempts >= job.max_attempts:
                job.status = "dead"
                job.worker_id = None
                job.progress = 0
                redis_service.clear_epoch(job.id)
                log_audit(db, "JOB_DEAD_LETTERED", {
                    "jobId": job.id, "type": job.type, "attempts": job.attempts,
                    "reason": error_info,
                })
                redis_service.publish_event("log:stream", {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "level": "error",
                    "source": worker.hostname,
                    "message": f"Job {job.id[:8]} exhausted {job.max_attempts} attempts - moved to Dead-Letter Queue.",
                })
            else:
                job.status = "failed"
                job.worker_id = None
                job.progress = 0
                delay_ms = job.backoff_ms * (2 ** (job.attempts - 1))
                redis_service.enqueue_delayed(job.id, job.priority, delay_ms)
                redis_service.publish_event("log:stream", {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "level": "warn",
                    "source": worker.hostname,
                    "message": f"Job {job.id[:8]} failed (attempt {job.attempts}/{job.max_attempts}) - retrying in {delay_ms}ms.",
                })
        else:
            attempt.status = "completed"
            attempt.ended_at = datetime.now(timezone.utc)
            attempt.duration_ms = duration_ms

            job.status = "completed"
            job.progress = 100
            job.result = {
                "message": f"{job.type} completed successfully",
                "itemsProcessed": items,
                "durationMs": duration_ms,
                "processedBy": worker.hostname,
            }
            worker.jobs_processed += 1
            redis_service.clear_epoch(job.id)
            redis_service.publish_event("log:stream", {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "info",
                "source": worker.hostname,
                "message": f"Job {job.id[:8]} ({job.type}) completed in {duration_ms}ms.",
            })

        worker.current_job_id = None
        worker.current_job_type = None
        worker.current_job_progress = 0
        db.commit()
        redis_service.publish_event("job:updated", job_to_dict(job))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", required=True)
    parser.add_argument("--hostname", required=True)
    args = parser.parse_args()

    worker = WorkerProcess(worker_id=args.id, hostname=args.hostname)
    try:
        worker.run()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
