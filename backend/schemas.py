"""
Explicit serializers for SQLAlchemy models.

Returning raw SQLAlchemy ORM objects from a FastAPI route (without a
Pydantic response_model) makes FastAPI's jsonable_encoder fall back to
vars(obj), which includes the internal `_sa_instance_state` attribute and
is not JSON serializable. These helpers avoid that entirely.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def job_to_dict(job) -> Dict[str, Any]:
    return {
        "id": job.id,
        "type": job.type,
        "payload": job.payload or {},
        "status": job.status,
        "priority": job.priority,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "backoff_ms": job.backoff_ms,
        "lease_epoch": job.lease_epoch,
        "run_at": _iso(job.run_at),
        "worker_id": job.worker_id,
        "progress": job.progress,
        "result": job.result,
        "created_at": _iso(job.created_at),
        "updated_at": _iso(job.updated_at),
    }


def attempt_to_dict(attempt) -> Dict[str, Any]:
    return {
        "id": attempt.id,
        "job_id": attempt.job_id,
        "worker_id": attempt.worker_id,
        "worker_pid": attempt.worker_pid,
        "attempt_number": attempt.attempt_number,
        "started_at": _iso(attempt.started_at),
        "ended_at": _iso(attempt.ended_at),
        "duration_ms": attempt.duration_ms,
        "status": attempt.status,
        "error_code": attempt.error_code,
        "error_message": attempt.error_message,
        "stack_trace": attempt.stack_trace,
    }


def worker_to_dict(worker) -> Dict[str, Any]:
    return {
        "id": worker.id,
        "pid": worker.pid,
        "hostname": worker.hostname,
        "status": worker.status,
        "concurrency": worker.concurrency,
        "jobs_processed": worker.jobs_processed,
        "jobs_failed": worker.jobs_failed,
        "started_at": _iso(worker.started_at),
        "last_heartbeat": _iso(worker.last_heartbeat),
        "current_job_id": worker.current_job_id,
        "current_job_type": worker.current_job_type,
        "current_job_progress": worker.current_job_progress,
        "memory_mb": worker.memory_mb,
    }


def audit_to_dict(entry) -> Dict[str, Any]:
    return {
        "id": entry.id,
        "timestamp": _iso(entry.timestamp),
        "action": entry.action,
        "details": entry.details,
    }
