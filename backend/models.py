import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, DateTime, JSON, Text, ForeignKey,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def _utcnow():
    """Timezone-aware UTC timestamp (replaces deprecated datetime.utcnow())."""
    return datetime.now(timezone.utc)

class JobModel(Base):
    __tablename__ = "jobs"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    type = Column(String(100), nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    status = Column(String(50), nullable=False, default="pending")
    priority = Column(Integer, nullable=False, default=5)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    backoff_ms = Column(Integer, nullable=False, default=2000)
    lease_epoch = Column(Integer, nullable=False, default=1)
    run_at = Column(DateTime, nullable=True)
    worker_id = Column(String(64), nullable=True)
    progress = Column(Integer, default=0)
    result = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    attempts_rel = relationship("JobAttemptModel", back_populates="job", cascade="all, delete-orphan")


class JobAttemptModel(Base):
    __tablename__ = "job_attempts"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(64), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(String(64), nullable=True)
    worker_pid = Column(Integer, nullable=True)
    attempt_number = Column(Integer, nullable=False)
    started_at = Column(DateTime, default=_utcnow)
    ended_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(50), nullable=False)
    error_code = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)
    stack_trace = Column(Text, nullable=True)

    job = relationship("JobModel", back_populates="attempts_rel")


class WorkerModel(Base):
    __tablename__ = "workers"

    id = Column(String(64), primary_key=True)
    pid = Column(Integer, nullable=False)
    hostname = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default="online")
    concurrency = Column(Integer, default=1)
    jobs_processed = Column(Integer, default=0)
    jobs_failed = Column(Integer, default=0)
    started_at = Column(DateTime, default=_utcnow)
    last_heartbeat = Column(DateTime, default=_utcnow)
    current_job_id = Column(String(64), nullable=True)
    current_job_type = Column(String(100), nullable=True)
    current_job_progress = Column(Integer, default=0)
    memory_mb = Column(Integer, default=45)


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id = Column(String(64), primary_key=True, default=lambda: str(uuid.uuid4())[:8])
    timestamp = Column(DateTime, default=_utcnow)
    action = Column(String(100), nullable=False)
    details = Column(JSON, nullable=True)
