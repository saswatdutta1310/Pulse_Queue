import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { JobRecord, JobAttempt, WorkerNode, QueueMetrics, JobStatus } from '../../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface DatabaseData {
  jobs: Record<string, JobRecord>;
  attempts: Record<string, JobAttempt[]>;
  workers: Record<string, WorkerNode>;
  auditLog: Array<{ id: string; timestamp: string; action: string; details: any }>;
  atLeastOnceRecoveries: number;
}

class StorageEngine {
  private data: DatabaseData = {
    jobs: {},
    attempts: {},
    workers: {},
    auditLog: [],
    atLeastOnceRecoveries: 0
  };
  private isSaving: boolean = false;
  private pendingSave: boolean = false;

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          this.data = {
            jobs: parsed.jobs || {},
            attempts: parsed.attempts || {},
            workers: parsed.workers || {},
            auditLog: parsed.auditLog || [],
            atLeastOnceRecoveries: parsed.atLeastOnceRecoveries || 0
          };
          console.log(`[Storage] Loaded durable state: ${Object.keys(this.data.jobs).length} jobs, ${Object.keys(this.data.workers).length} workers.`);
          return;
        }
      }
      this.saveSync();
    } catch (err: any) {
      console.error('[Storage] Error initializing database file, recreating:', err.message);
      this.saveSync();
    }
  }

  private saveSync() {
    try {
      const tempPath = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err: any) {
      console.error('[Storage] Save error:', err.message);
    }
  }

  public queueSave() {
    if (this.isSaving) {
      this.pendingSave = true;
      return;
    }
    this.isSaving = true;
    setTimeout(() => {
      this.saveSync();
      this.isSaving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        this.queueSave();
      }
    }, 100);
  }

  // Jobs
  public saveJob(job: JobRecord): void {
    this.data.jobs[job.id] = { ...job, updated_at: new Date().toISOString() };
    this.queueSave();
  }

  public getJob(id: string): JobRecord | undefined {
    return this.data.jobs[id];
  }

  public updateJobStatus(id: string, status: JobStatus, extra?: Partial<JobRecord>): JobRecord | undefined {
    const job = this.data.jobs[id];
    if (!job) return undefined;
    
    this.data.jobs[id] = {
      ...job,
      status,
      ...extra,
      updated_at: new Date().toISOString()
    };
    this.queueSave();
    return this.data.jobs[id];
  }

  public listJobs(filter?: { status?: string; type?: string; search?: string }): JobRecord[] {
    let list = Object.values(this.data.jobs);

    if (filter?.status && filter.status !== 'all') {
      list = list.filter(j => j.status === filter.status);
    }
    if (filter?.type && filter.type !== 'all') {
      list = list.filter(j => j.type === filter.type);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(j => 
        j.id.toLowerCase().includes(q) || 
        j.type.toLowerCase().includes(q) ||
        JSON.stringify(j.payload).toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  // Attempts
  public recordAttempt(attempt: JobAttempt): void {
    if (!this.data.attempts[attempt.job_id]) {
      this.data.attempts[attempt.job_id] = [];
    }
    const list = this.data.attempts[attempt.job_id];
    const existingIndex = list.findIndex(a => a.id === attempt.id);
    if (existingIndex >= 0) {
      list[existingIndex] = attempt;
    } else {
      list.push(attempt);
    }
    this.queueSave();
  }

  public getAttempts(jobId: string): JobAttempt[] {
    return (this.data.attempts[jobId] || []).sort(
      (a, b) => a.attempt_number - b.attempt_number
    );
  }

  // Workers
  public saveWorker(worker: WorkerNode): void {
    this.data.workers[worker.id] = { ...worker };
    this.queueSave();
  }

  public getWorker(id: string): WorkerNode | undefined {
    return this.data.workers[id];
  }

  public updateWorkerHeartbeat(id: string, progress?: number, memoryMb?: number): WorkerNode | undefined {
    const w = this.data.workers[id];
    if (!w) return undefined;
    w.last_heartbeat = new Date().toISOString();
    w.status = 'online';
    if (progress !== undefined) w.current_job_progress = progress;
    if (memoryMb !== undefined) w.memory_mb = memoryMb;
    this.data.workers[id] = w;
    this.queueSave();
    return w;
  }

  public listWorkers(): WorkerNode[] {
    return Object.values(this.data.workers);
  }

  public removeWorker(id: string): void {
    delete this.data.workers[id];
    this.queueSave();
  }

  // Metrics
  public incrementRecoveryCount(): void {
    this.data.atLeastOnceRecoveries = (this.data.atLeastOnceRecoveries || 0) + 1;
    this.queueSave();
  }

  public getMetrics(): QueueMetrics {
    const jobs = Object.values(this.data.jobs);
    const workers = Object.values(this.data.workers);
    
    const totalJobs = jobs.length;
    const pendingJobs = jobs.filter(j => j.status === 'pending').length;
    const activeJobs = jobs.filter(j => j.status === 'active').length;
    const completedJobs = jobs.filter(j => j.status === 'completed').length;
    const failedJobs = jobs.filter(j => j.status === 'failed').length;
    const deadJobs = jobs.filter(j => j.status === 'dead').length;
    const delayedJobs = jobs.filter(j => j.status === 'delayed').length;
    const onlineWorkers = workers.filter(w => w.status === 'online').length;

    // Calculate throughput in the last minute
    const oneMinAgo = Date.now() - 60000;
    const throughputPerMin = jobs.filter(
      j => j.status === 'completed' && new Date(j.updated_at).getTime() > oneMinAgo
    ).length;

    // Calculate average completed job duration
    let totalDuration = 0;
    let countedAttempts = 0;
    Object.values(this.data.attempts).forEach(attList => {
      attList.forEach(a => {
        if (a.duration_ms) {
          totalDuration += a.duration_ms;
          countedAttempts++;
        }
      });
    });

    const avgDurationMs = countedAttempts > 0 ? Math.round(totalDuration / countedAttempts) : 0;

    return {
      totalJobs,
      pendingJobs,
      activeJobs,
      completedJobs,
      failedJobs,
      deadJobs,
      delayedJobs,
      onlineWorkers,
      totalWorkers: workers.length,
      throughputPerMin,
      avgDurationMs,
      atLeastOnceRecoveries: this.data.atLeastOnceRecoveries || 0
    };
  }

  // Audit Logs
  public addAuditLog(action: string, details: any): void {
    this.data.auditLog.unshift({
      id: Math.random().toString(36).substring(2, 10),
      timestamp: new Date().toISOString(),
      action,
      details
    });
    if (this.data.auditLog.length > 500) {
      this.data.auditLog = this.data.auditLog.slice(0, 500);
    }
    this.queueSave();
  }

  public getAuditLogs(limit: number = 100) {
    return this.data.auditLog.slice(0, limit);
  }
}

export const db = new StorageEngine();
