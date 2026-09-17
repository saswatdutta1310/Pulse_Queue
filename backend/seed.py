"""
PulseQueue Database & Cache Seeder
Clears all previous data and populates fresh, realistic demonstration data.
"""
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

from config import settings
from database import SessionLocal, init_db
from models import AuditLogModel, JobAttemptModel, JobModel, WorkerModel
from process_manager import process_manager
from redis_service import redis_service


def _now(offset_seconds: float = 0) -> datetime:
    """Returns a timezone-aware UTC datetime adjusted by offset_seconds."""
    return datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)


def seed_database(pm=None):
    if pm is None:
        pm = process_manager

    print("[Seed] Initializing database schemas...")
    init_db()

    # 1. Clean Redis queues and lease epochs
    print("[Seed] Purging Redis queues and lease epochs...")
    try:
        keys_to_clear = [
            redis_service.WAIT_KEY,
            redis_service.DELAYED_KEY,
            redis_service.DELAYED_META_KEY,
        ]
        for key in keys_to_clear:
            redis_service.client.delete(key)

        epoch_keys = redis_service.client.keys("job:epoch:*")
        if epoch_keys:
            redis_service.client.delete(*epoch_keys)
        print(f"[Seed] Cleared Redis keys ({len(epoch_keys)} epochs removed).")
    except Exception as e:
        print(f"[Seed] Warning clearing Redis: {e}")

    # 2. Shut down existing tracked processes
    try:
        pm.shutdown_all()
    except Exception as e:
        print(f"[Seed] Note on process shutdown: {e}")

    # 3. Clear Database tables
    db = SessionLocal()
    try:
        print("[Seed] Truncating database tables...")
        db.query(JobAttemptModel).delete()
        db.query(JobModel).delete()
        db.query(WorkerModel).delete()
        db.query(AuditLogModel).delete()
        db.commit()
        print("[Seed] All previous rows deleted successfully.")

        # 4. Spawn 3 real worker processes for continuous healthy heartbeats
        print("[Seed] Bootstrapping real worker fleet processes...")
        worker_ids = []
        hostnames = ["worker-node-1 [us-east]", "worker-node-2 [eu-central]", "worker-node-3 [ap-south]"]

        for i, hname in enumerate(hostnames, start=1):
            w_id = f"w-{uuid.uuid4().hex[:8]}"
            worker = WorkerModel(
                id=w_id,
                pid=0,
                hostname=hname,
                status="online",
                concurrency=2 if i <= 2 else 1,
                jobs_processed=12 + (i * 7),
                jobs_failed=1 if i == 2 else 0,
                memory_mb=65 + (i * 6),
                started_at=_now(-3600),
                last_heartbeat=_now(),
            )
            db.add(worker)
            db.commit()

            try:
                real_pid = pm.spawn(w_id, hname)
                worker.pid = real_pid
                db.commit()
                worker_ids.append((w_id, hname, real_pid))
                print(f"[Seed] Spawned {hname} with PID {real_pid}")
            except Exception as ex:
                print(f"[Seed] Failed to spawn worker subprocess: {ex}")
                worker_ids.append((w_id, hname, 10000 + i))

        # Add 1 historical dead worker to showcase the Heartbeat Reaper's past failover
        dead_w_id = f"w-{uuid.uuid4().hex[:8]}"
        dead_worker = WorkerModel(
            id=dead_w_id,
            pid=9999,
            hostname="worker-node-4 [chaos-standby]",
            status="dead",
            concurrency=1,
            jobs_processed=8,
            jobs_failed=2,
            memory_mb=0,
            started_at=_now(-7200),
            last_heartbeat=_now(-620),
        )
        db.add(dead_worker)
        db.commit()

        # Primary online workers for job references
        w1_id, w1_name, w1_pid = worker_ids[0]
        w2_id, w2_name, w2_pid = worker_ids[1]
        w3_id, w3_name, w3_pid = worker_ids[2]

        # 5. Completed Jobs
        print("[Seed] Seeding completed historical workloads...")
        completed_data = [
            (
                "data_sync",
                {"taskName": "Customer ETL Migration Sync", "itemsCount": 2500, "chunkSize": 100, "sourceDb": "pg-primary-cluster", "targetWarehouse": "snowflake-analytics"},
                2, 340, w1_id, w1_name, w1_pid, -900
            ),
            (
                "report_export",
                {"taskName": "Quarterly Financial Ledger Export", "format": "csv", "records": 8450, "destination": "s3://reports-ledger/q3-2026.csv"},
                3, 480, w2_id, w2_name, w2_pid, -810
            ),
            (
                "heavy_computation",
                {"taskName": "Cryptographic Prime Sieve Verification", "complexity": 920000, "algorithm": "sha3_512"},
                1, 620, w3_id, w3_name, w3_pid, -720
            ),
            (
                "webhook_dispatch",
                {"taskName": "Stripe Webhook: invoice.payment_succeeded", "event": "invoice.payment_succeeded", "customerId": "cus_9xK20alP", "amount": 14900},
                1, 145, w1_id, w1_name, w1_pid, -640
            ),
            (
                "data_sync",
                {"taskName": "Product Catalog Elasticsearch Indexing", "itemsCount": 1800, "index": "catalog-v4"},
                4, 295, w2_id, w2_name, w2_pid, -550
            ),
            (
                "heavy_computation",
                {"taskName": "Vector Embedding Batch: text-embedding-3", "complexity": 640000, "tokenCount": 42000},
                2, 510, w1_id, w1_name, w1_pid, -480
            ),
            (
                "report_export",
                {"taskName": "Security Access Compliance Audit", "format": "pdf", "records": 420},
                5, 380, w3_id, w3_name, w3_pid, -390
            ),
            (
                "webhook_dispatch",
                {"taskName": "Slack Alert: Cluster Scaling Event", "channel": "#ops-telemetry", "severity": "info"},
                6, 115, w2_id, w2_name, w2_pid, -300
            ),
            (
                "data_sync",
                {"taskName": "Real-time Order Book Aggregation", "itemsCount": 3100, "market": "crypto-spot"},
                3, 410, w1_id, w1_name, w1_pid, -210
            ),
            (
                "heavy_computation",
                {"taskName": "Monte Carlo VaR Risk Assessment", "complexity": 850000, "iterations": 100000},
                2, 590, w2_id, w2_name, w2_pid, -120
            ),
        ]

        for j_type, payload, priority, duration, wid, hname, wpid, time_offset in completed_data:
            job_id = str(uuid.uuid4())
            created_time = _now(time_offset)
            ended_time = _now(time_offset + duration / 1000.0)

            job = JobModel(
                id=job_id,
                type=j_type,
                payload=payload,
                status="completed",
                priority=priority,
                attempts=1,
                max_attempts=3,
                backoff_ms=2000,
                lease_epoch=1,
                worker_id=wid,
                progress=100,
                result={
                    "message": f"{j_type} completed successfully",
                    "itemsProcessed": payload.get("itemsCount") or payload.get("records") or payload.get("complexity", 100),
                    "durationMs": duration,
                    "processedBy": hname,
                    "status": "200_OK"
                },
                created_at=created_time,
                updated_at=ended_time,
            )
            db.add(job)

            attempt = JobAttemptModel(
                job_id=job_id,
                worker_id=wid,
                worker_pid=wpid,
                attempt_number=1,
                started_at=created_time,
                ended_at=ended_time,
                duration_ms=duration,
                status="completed",
            )
            db.add(attempt)

        # 6. Rescued Failover Job (Demonstrates zero-data-loss architecture!)
        print("[Seed] Seeding rescued failover job...")
        failover_job_id = str(uuid.uuid4())
        fo_created = _now(-450)
        fo_crashed_time = _now(-435)
        fo_recovered_time = _now(-425)
        fo_ended = _now(-424)

        rescued_job = JobModel(
            id=failover_job_id,
            type="data_sync",
            payload={"taskName": "Distributed Ledger Multi-Region Reconciliation", "itemsCount": 5000, "criticality": "HIGH"},
            status="completed",
            priority=1,
            attempts=1,
            max_attempts=3,
            backoff_ms=2000,
            lease_epoch=2,
            worker_id=w2_id,
            progress=100,
            result={
                "message": "data_sync completed successfully after zero-loss failover",
                "itemsProcessed": 5000,
                "durationMs": 310,
                "processedBy": w2_name,
                "failoverRescued": True,
                "fencingTokenEpoch": 2
            },
            created_at=fo_created,
            updated_at=fo_ended,
        )
        db.add(rescued_job)

        attempt_crashed = JobAttemptModel(
            job_id=failover_job_id,
            worker_id=dead_w_id,
            worker_pid=9999,
            attempt_number=1,
            started_at=fo_created,
            ended_at=fo_crashed_time,
            duration_ms=450,
            status="worker_killed",
            error_code="WORKER_HEARTBEAT_TIMEOUT",
            error_message="Worker worker-node-4 missed 3 heartbeats. Heartbeat Reaper autonomous watchdog reclaimed task.",
            stack_trace="ReaperAutonomousWatchdog: Heartbeat expired (>5.5s). Fencing token incremented to epoch 2. Job re-queued to head of wait queue with zero data loss."
        )
        db.add(attempt_crashed)

        attempt_rescued = JobAttemptModel(
            job_id=failover_job_id,
            worker_id=w2_id,
            worker_pid=w2_pid,
            attempt_number=2,
            started_at=fo_recovered_time,
            ended_at=fo_ended,
            duration_ms=310,
            status="completed",
        )
        db.add(attempt_rescued)

        # 7. Dead-Letter Queue (DLQ) & Retrying Failures
        print("[Seed] Seeding dead-letter queue records...")
        dlq_job_id = str(uuid.uuid4())
        dlq_created = _now(-500)
        dlq_job = JobModel(
            id=dlq_job_id,
            type="fault_simulation",
            payload={"taskName": "Legacy Payment Gateway Settlement", "shouldFail": True, "failureMessage": "Connection reset by payment peer during SSL handshake", "sleepMs": 150},
            status="dead",
            priority=4,
            attempts=3,
            max_attempts=3,
            backoff_ms=2000,
            lease_epoch=1,
            worker_id=w1_id,
            progress=60,
            created_at=dlq_created,
            updated_at=_now(-420),
        )
        db.add(dlq_job)

        for a_num, err_code, err_msg in [
            (1, "GATEWAY_HANDSHAKE_RESET", "Connection reset by payment peer during SSL handshake"),
            (2, "UPSTREAM_TIMEOUT_504", "Upstream payment settlement service timed out after 2000ms backoff"),
            (3, "EXHAUSTED_MAX_RETRIES", "Maximum attempt limit (3/3) reached. Quarantined in Dead-Letter Queue (DLQ)"),
        ]:
            att_start = _now(-500 + (a_num * 25))
            att_end = _now(-500 + (a_num * 25) + 0.3)
            db.add(JobAttemptModel(
                job_id=dlq_job_id,
                worker_id=w1_id,
                worker_pid=w1_pid,
                attempt_number=a_num,
                started_at=att_start,
                ended_at=att_end,
                duration_ms=250,
                status="failed",
                error_code=err_code,
                error_message=err_msg,
                stack_trace=f"Traceback (most recent call last):\n  File \"worker_process.py\", line 182, in _process_job\nTaskExecutionError: {err_msg}\n  at worker={w1_name} pid={w1_pid} attempt=#{a_num}",
            ))

        retry_job_id = str(uuid.uuid4())
        retry_job = JobModel(
            id=retry_job_id,
            type="webhook_dispatch",
            payload={"taskName": "Partner Webhook Event Notification", "targetUrl": "https://api.partner.io/v2/events", "retryable": True},
            status="failed",
            priority=5,
            attempts=2,
            max_attempts=3,
            backoff_ms=4000,
            lease_epoch=1,
            worker_id=w2_id,
            progress=40,
            created_at=_now(-180),
            updated_at=_now(-20),
        )
        db.add(retry_job)
        db.add(JobAttemptModel(
            job_id=retry_job_id,
            worker_id=w2_id,
            worker_pid=w2_pid,
            attempt_number=1,
            started_at=_now(-175),
            ended_at=_now(-174.8),
            duration_ms=195,
            status="failed",
            error_code="HTTP_503_UNAVAILABLE",
            error_message="Downstream endpoint returned HTTP 503 Service Unavailable",
            stack_trace="Traceback (most recent call last):\n  File \"worker_process.py\", line 182\nHttpException: 503 Service Unavailable",
        ))

        # 8. Pending Jobs
        print("[Seed] Enqueueing pending workloads...")
        pending_jobs_data = [
            ("data_sync", {"taskName": "Nightly Warehouse Stock Sync", "itemsCount": 4200, "warehouse": "east-hub"}, 2),
            ("report_export", {"taskName": "Monthly Tax Withholding Summary", "format": "xlsx", "records": 1200}, 5),
            ("webhook_dispatch", {"taskName": "Customer Welcome Sequence Dispatch", "userId": "usr_99812"}, 6),
        ]
        for p_type, p_payload, p_priority in pending_jobs_data:
            p_id = str(uuid.uuid4())
            p_job = JobModel(
                id=p_id,
                type=p_type,
                payload=p_payload,
                status="pending",
                priority=p_priority,
                max_attempts=3,
                backoff_ms=2000,
                lease_epoch=1,
                created_at=_now(-15),
                updated_at=_now(-15),
            )
            db.add(p_job)
            try:
                redis_service.enqueue_job(p_id, priority=p_priority, delay_ms=0)
            except Exception as e:
                print(f"[Seed] Redis enqueue warning: {e}")

        # 9. Delayed Job
        print("[Seed] Enqueueing delayed job...")
        del_id = str(uuid.uuid4())
        del_job = JobModel(
            id=del_id,
            type="report_export",
            payload={"taskName": "Scheduled Daily Executive Snapshot", "format": "pdf", "scheduledFor": "05:00 UTC"},
            status="delayed",
            priority=3,
            max_attempts=3,
            backoff_ms=2000,
            lease_epoch=1,
            run_at=_now(300),
            created_at=_now(-10),
            updated_at=_now(-10),
        )
        db.add(del_job)
        try:
            redis_service.enqueue_job(del_id, priority=3, delay_ms=300000)
        except Exception as e:
            print(f"[Seed] Redis delayed enqueue warning: {e}")

        # 10. Audit Logs
        print("[Seed] Recording audit trail...")
        audit_records = [
            ("SYSTEM_INITIALIZED", {"version": "2.4.0", "storage": "SQLite + Redis", "orchestrator": "PulseQueue BullMQ"}, -3600),
            ("WORKER_FLEET_SPAWNED", {"workers": hostnames, "totalConcurrency": 5}, -3590),
            ("JOB_BATCH_ENQUEUED", {"batchSize": 10, "jobType": "mixed", "priorityRange": "1-6"}, -920),
            ("HEARTBEAT_REAPER_SWEEP", {"status": "healthy", "intervalMs": 2500, "responsiveNodes": 3}, -460),
            ("WORKER_KILLED_CHAOS", {"workerId": dead_w_id, "hostname": "worker-node-4 [chaos-standby]", "reason": "Simulated hardware fault"}, -440),
            ("FAILOVER_RECLAIMED", {"jobId": failover_job_id, "previousWorker": "worker-node-4", "newEpoch": 2, "action": "re-queued to head of wait queue"}, -435),
            ("JOB_COMPLETED", {"jobId": failover_job_id, "assignedWorker": w2_name, "recovered": True}, -424),
            ("DEAD_LETTER_QUARANTINE", {"jobId": dlq_job_id, "attempts": 3, "reason": "EXHAUSTED_MAX_RETRIES"}, -420),
        ]
        for action, details, time_offset in audit_records:
            db.add(AuditLogModel(
                id=str(uuid.uuid4())[:8],
                timestamp=_now(time_offset),
                action=action,
                details=details,
            ))

        db.commit()
        print("[Seed] Done! Database is now seeded with fresh, dynamic data.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
