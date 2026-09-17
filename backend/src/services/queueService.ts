import { Queue, QueueEvents } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { ENV } from '../config/env.js';
import { createRedisClient, redisClient } from '../config/redis.js';
import { db } from '../db/index.js';
import type { JobRecord, JobType, JobPayload, JobStatus } from '../../../shared/types.js';

export const QUEUE_NAME = 'pulse-queue';

export class QueueService {
  private queue: Queue;
  private queueEvents: QueueEvents;
  private io: any = null;

  constructor() {
    const queueConnection = createRedisClient('bullmq-queue');
    const eventsConnection = createRedisClient('bullmq-events');

    this.queue = new Queue(QUEUE_NAME, {
      connection: queueConnection as any,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 2000,
      }
    });

    this.queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: eventsConnection as any
    });

    this.setupEventListeners();
  }

  public setSocketServer(io: any) {
    this.io = io;
  }

  private setupEventListeners() {
    this.queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      let parsedResult = returnvalue;
      try {
        if (typeof returnvalue === 'string' && (returnvalue.startsWith('{') || returnvalue.startsWith('['))) {
          parsedResult = JSON.parse(returnvalue);
        }
      } catch {}

      const updated = db.updateJobStatus(jobId, 'completed', {
        progress: 100,
        result: parsedResult
      });

      if (updated && this.io) {
        this.io.emit('job:updated', updated);
        this.broadcastMetrics();
      }
    });

    this.queueEvents.on('failed', async ({ jobId, failedReason }) => {
      const job = db.getJob(jobId);
      if (!job) return;

      const isDead = job.attempts >= job.max_attempts;
      const status: JobStatus = isDead ? 'dead' : 'failed';

      const updated = db.updateJobStatus(jobId, status, {
        progress: job.progress || 0
      });

      if (updated && this.io) {
        this.io.emit('job:updated', updated);
        this.broadcastMetrics();
      }
    });

    this.queueEvents.on('progress', async ({ jobId, data }) => {
      const progressNum = typeof data === 'number' ? data : (data as any)?.progress || 0;
      const updated = db.updateJobStatus(jobId, 'active', { progress: progressNum });
      if (updated && this.io) {
        this.io.emit('job:updated', updated);
      }
    });

    this.queueEvents.on('delayed', async ({ jobId, delay }) => {
      const updated = db.updateJobStatus(jobId, 'delayed');
      if (updated && this.io) {
        this.io.emit('job:updated', updated);
        this.broadcastMetrics();
      }
    });

    this.queueEvents.on('waiting', async ({ jobId }) => {
      const current = db.getJob(jobId);
      if (current && current.status !== 'active') {
        const updated = db.updateJobStatus(jobId, 'pending');
        if (updated && this.io) {
          this.io.emit('job:updated', updated);
          this.broadcastMetrics();
        }
      }
    });
  }

  public async enqueueJob(params: {
    type: JobType;
    payload: JobPayload;
    priority?: number;
    maxAttempts?: number;
    backoffMs?: number;
    delayMs?: number;
  }): Promise<JobRecord> {
    const id = uuidv4();
    const priority = params.priority || 5;
    const maxAttempts = params.maxAttempts || 3;
    const backoffMs = params.backoffMs || 2000;
    const delayMs = params.delayMs || 0;
    const now = new Date();
    const runAt = delayMs > 0 ? new Date(now.getTime() + delayMs).toISOString() : null;

    const record: JobRecord = {
      id,
      type: params.type,
      payload: params.payload,
      status: delayMs > 0 ? 'delayed' : 'pending',
      priority,
      attempts: 0,
      max_attempts: maxAttempts,
      backoff_ms: backoffMs,
      run_at: runAt,
      worker_id: null,
      progress: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    db.saveJob(record);
    db.addAuditLog('JOB_ENQUEUED', { id, type: params.type, priority, delayMs });

    // Enqueue to BullMQ
    await this.queue.add(params.type, params.payload, {
      jobId: id,
      priority,
      attempts: maxAttempts,
      backoff: {
        type: 'exponential',
        delay: backoffMs
      },
      delay: delayMs
    });

    if (this.io) {
      this.io.emit('job:created', record);
      this.broadcastMetrics();
    }

    return record;
  }

  public async retryJob(id: string): Promise<JobRecord | null> {
    const job = db.getJob(id);
    if (!job) return null;

    // Reset status to pending
    const updated = db.updateJobStatus(id, 'pending', {
      attempts: 0,
      progress: 0,
      worker_id: null
    });

    // Remove old job if exists in BullMQ and re-add
    try {
      const existing = await this.queue.getJob(id);
      if (existing) {
        await existing.remove();
      }
    } catch {}

    await this.queue.add(job.type, job.payload, {
      jobId: id,
      priority: job.priority,
      attempts: job.max_attempts,
      backoff: {
        type: 'exponential',
        delay: job.backoff_ms
      }
    });

    db.addAuditLog('JOB_MANUAL_RETRY', { id });

    if (updated && this.io) {
      this.io.emit('job:updated', updated);
      this.broadcastMetrics();
    }

    return updated || null;
  }

  public async cancelJob(id: string): Promise<boolean> {
    const job = db.getJob(id);
    if (!job) return false;

    try {
      const bullJob = await this.queue.getJob(id);
      if (bullJob) {
        await bullJob.remove();
      }
    } catch {}

    const updated = db.updateJobStatus(id, 'dead');
    db.addAuditLog('JOB_CANCELLED', { id });

    if (updated && this.io) {
      this.io.emit('job:updated', updated);
      this.broadcastMetrics();
    }

    return true;
  }

  public broadcastMetrics() {
    if (this.io) {
      const metrics = db.getMetrics();
      this.io.emit('metrics:update', metrics);
    }
  }

  public getRawQueue(): Queue {
    return this.queue;
  }
}

export const queueService = new QueueService();
