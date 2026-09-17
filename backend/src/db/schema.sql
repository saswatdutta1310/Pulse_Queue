-- PulseQueue Database Schema (PostgreSQL / Supabase compatible)

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY,
  pid INT NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'online',
  concurrency INT NOT NULL DEFAULT 1,
  jobs_processed INT NOT NULL DEFAULT 0,
  jobs_failed INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority INT NOT NULL DEFAULT 5,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  backoff_ms INT NOT NULL DEFAULT 2000,
  run_at TIMESTAMPTZ,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  progress INT DEFAULT 0,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  worker_pid INT,
  attempt_number INT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_ms INT,
  status VARCHAR(50) NOT NULL,
  error_code VARCHAR(100),
  error_message TEXT,
  stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action VARCHAR(100) NOT NULL,
  details JSONB
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_worker_id ON jobs(worker_id);
CREATE INDEX IF NOT EXISTS idx_job_attempts_job_id ON job_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers(last_heartbeat);
