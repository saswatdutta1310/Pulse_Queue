import { ENV } from '../config/env.js';
import { redisClient } from '../config/redis.js';
import { db } from '../db/index.js';
import { queueService } from './queueService.js';
import type { WorkerNode, JobRecord } from '../../../shared/types.js';

export class HeartbeatReaper {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private io: any = null;
  private lastSweepTimestamp: number = Date.now();

  public isHealthy(): boolean {
    // Healthy if last sweep happened within 3x interval
    return Date.now() - this.lastSweepTimestamp < (ENV.REAPER_INTERVAL_MS * 3);
  }

  public setSocketServer(io: any) {
    this.io = io;
  }


  public start() {
    if (this.timer) return;
    console.log(`[HeartbeatReaper] Starting liveness daemon (interval: ${ENV.REAPER_INTERVAL_MS}ms, threshold: ${ENV.MISSED_HEARTBEAT_THRESHOLD_MS}ms)...`);
    this.timer = setInterval(() => this.reap(), ENV.REAPER_INTERVAL_MS);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async reap() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastSweepTimestamp = Date.now();

    try {

      const now = Date.now();
      const workers = db.listWorkers();

      for (const worker of workers) {
        // Only check workers marked online or degraded
        if (worker.status !== 'online' && worker.status !== 'degraded') {
          continue;
        }

        const lastBeatTime = new Date(worker.last_heartbeat).getTime();
        const elapsed = now - lastBeatTime;

        // Check Redis TTL key as primary check
        const redisKeyExists = await redisClient.exists(`worker:heartbeat:${worker.id}`);

        if (!redisKeyExists && elapsed > ENV.MISSED_HEARTBEAT_THRESHOLD_MS) {
          console.warn(`[HeartbeatReaper] Worker ${worker.id} (PID ${worker.pid}) missed heartbeats (${elapsed}ms elapsed). Marking DEAD.`);
          
          // Mark worker as dead
          worker.status = 'dead';
          db.saveWorker(worker);

          if (this.io) {
            this.io.emit('worker:status', worker);
            this.io.emit('log:stream', {
              timestamp: new Date().toISOString(),
              level: 'error',
              source: 'HeartbeatReaper',
              message: `Worker ${worker.hostname} (PID: ${worker.pid}) failed to heartbeat. Marked as DEAD.`
            });
          }

          // Check if worker was holding an in-flight job
          if (worker.current_job_id) {
            await this.reassignJob(worker, worker.current_job_id);
            worker.current_job_id = null;
            worker.current_job_type = null;
            worker.current_job_progress = 0;
            db.saveWorker(worker);
          }
        }
      }

      // Broadcast updated worker list to clients
      if (this.io) {
        this.io.emit('workers:update', db.listWorkers());
      }
    } catch (err: any) {
      console.error('[HeartbeatReaper] Error during reap cycle:', err.message);
    } finally {
      this.isRunning = false;
    }
  }

  private async reassignJob(worker: WorkerNode, jobId: string) {
    const job = db.getJob(jobId);
    if (!job) return;

    // If job already succeeded or died, don't reassign
    if (job.status === 'completed' || job.status === 'dead') {
      return;
    }

    console.log(`[HeartbeatReaper] IN-FLIGHT RESCUE: Reclaiming job ${jobId} from dead Worker ${worker.id} (PID: ${worker.pid})...`);

    // Log the failed attempt due to worker crash
    const attemptId = `att-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const nowIso = new Date().toISOString();

    db.recordAttempt({
      id: attemptId,
      job_id: jobId,
      worker_id: worker.id,
      worker_pid: worker.pid,
      attempt_number: job.attempts + 1,
      started_at: job.updated_at || nowIso,
      ended_at: nowIso,
      duration_ms: Math.max(0, Date.now() - new Date(job.updated_at || nowIso).getTime()),
      status: 'worker_killed',
      error_code: 'WORKER_HEARTBEAT_TIMEOUT',
      error_message: `Worker process (PID ${worker.pid}) stopped heartbeating unexpectedly mid-execution.`,
      stack_trace: `Error: Worker terminated abruptly while processing task.\n  at HeartbeatReaper.reassignJob (src/services/heartbeatReaper.ts)\n  at WorkerNode (${worker.id})`
    });

    job.attempts += 1;
    db.incrementRecoveryCount();

    // Invalidate Redis lease and increment fencing epoch to block zombie worker writes
    const { LeaseManager } = await import('./leaseManager.js');
    const newEpoch = await LeaseManager.invalidateLeaseAndBumpEpoch(jobId);
    job.lease_epoch = newEpoch;

    // Check if exceeded max attempts
    if (job.attempts >= job.max_attempts) {
      job.status = 'dead';
      job.worker_id = null;
      db.saveJob(job);
      console.warn(`[HeartbeatReaper] Job ${jobId} exceeded max attempts (${job.max_attempts}). Moved to DLQ.`);
      if (this.io) {
        this.io.emit('job:updated', job);
      }
      return;
    }

    // Reset job state and re-enqueue to BullMQ for another worker to pick up
    job.status = 'pending';
    job.worker_id = null;
    job.progress = 0;
    db.saveJob(job);

    db.addAuditLog('JOB_AUTO_REASSIGNED', {
      jobId,
      previousWorkerId: worker.id,
      previousPid: worker.pid,
      attempt: job.attempts,
      fencingEpoch: newEpoch
    });


    // Re-push to BullMQ
    const queue = queueService.getRawQueue();
    await queue.add(job.type, job.payload, {
      jobId: job.id,
      priority: Math.max(1, job.priority - 1), // Boost priority for re-enqueued jobs
      attempts: job.max_attempts - job.attempts,
      backoff: {
        type: 'exponential',
        delay: 1000
      }
    });

    if (this.io) {
      this.io.emit('job:updated', job);
      this.io.emit('job:reassigned', {
        jobId,
        previousWorkerId: worker.id,
        reason: `Worker PID ${worker.pid} crashed mid-execution. Job automatically recovered and re-queued.`
      });
      this.io.emit('log:stream', {
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'PulseFailover',
        message: `[AT-LEAST-ONCE] Job ${job.type} (${jobId.substring(0, 8)}) recovered from dead Worker PID ${worker.pid}. Reassigned to queue.`
      });
      queueService.broadcastMetrics();
    }
  }
}

export const heartbeatReaper = new HeartbeatReaper();
