export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'dead' | 'delayed' | 'cancelled';

export type WorkerStatus = 'online' | 'degraded' | 'dead' | 'killed';

export type JobType = 
  | 'data_sync'
  | 'report_export'
  | 'heavy_computation'
  | 'webhook_dispatch'
  | 'fault_simulation';

export interface JobPayload {
  taskName?: string;
  itemsCount?: number;
  format?: 'csv' | 'json' | 'pdf';
  targetUrl?: string;
  complexity?: number;
  shouldFail?: boolean;
  failAtPercent?: number;
  failureMessage?: string;
  sleepMs?: number;
  [key: string]: any;
}

export interface JobRecord {
  id: string;
  type: JobType;
  payload: JobPayload;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  backoff_ms: number;
  lease_epoch?: number;
  run_at?: string | null;
  worker_id?: string | null;
  progress?: number;
  result?: any;
  created_at: string;
  updated_at: string;
}


export interface JobAttempt {
  id: string;
  job_id: string;
  worker_id?: string | null;
  worker_pid?: number | null;
  attempt_number: number;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  status: 'running' | 'completed' | 'failed' | 'worker_killed';
  error_code?: string | null;
  error_message?: string | null;
  stack_trace?: string | null;
}

export interface WorkerNode {
  id: string;
  pid: number;
  hostname: string;
  status: WorkerStatus;
  concurrency: number;
  jobs_processed: number;
  jobs_failed: number;
  started_at: string;
  last_heartbeat: string;
  current_job_id?: string | null;
  current_job_type?: string | null;
  current_job_progress?: number;
  memory_mb?: number;
}

export interface QueueMetrics {
  totalJobs: number;
  pendingJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  deadJobs: number;
  delayedJobs: number;
  onlineWorkers: number;
  totalWorkers: number;
  throughputPerMin: number;
  avgDurationMs: number;
  atLeastOnceRecoveries: number;
}

export interface WebSocketEvents {
  'metrics:update': (metrics: QueueMetrics) => void;
  'workers:update': (workers: WorkerNode[]) => void;
  'job:created': (job: JobRecord) => void;
  'job:updated': (job: JobRecord) => void;
  'job:reassigned': (data: { jobId: string; previousWorkerId: string; newWorkerId?: string; reason: string }) => void;
  'worker:killed': (data: { workerId: string; pid: number; reason: string }) => void;
  'log:stream': (log: { timestamp: string; level: 'info' | 'warn' | 'error'; source: string; message: string }) => void;
}

export type UserRole = 'admin' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
}

export interface AuthSession {
  user: User;
  token: string;
}

