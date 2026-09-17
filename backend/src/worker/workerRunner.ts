import { Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis.js';
import { ENV } from '../config/env.js';
import { QUEUE_NAME } from '../services/queueService.js';
import type { WorkerNode } from '../../../shared/types.js';

const WORKER_ID = process.env.WORKER_ID || `w-${Date.now().toString(36)}`;
const WORKER_HOSTNAME = process.env.WORKER_HOSTNAME || `worker-node-${Math.floor(Math.random() * 1000)}`;
const concurrency = parseInt(process.env.CONCURRENCY || '1', 10);

console.log(`[WorkerRunner] Starting worker ${WORKER_HOSTNAME} (ID: ${WORKER_ID}) with concurrency ${concurrency}...`);

// Register worker via IPC
const workerNode: WorkerNode = {
  id: WORKER_ID,
  pid: process.pid,
  hostname: WORKER_HOSTNAME,
  status: 'online',
  concurrency,
  jobs_processed: 0,
  jobs_failed: 0,
  started_at: new Date().toISOString(),
  last_heartbeat: new Date().toISOString()
};
if (process.send) process.send({ type: 'WORKER_REGISTER', worker: workerNode });

// Heartbeat loop via IPC
setInterval(() => {
  if (process.send) process.send({ type: 'WORKER_HEARTBEAT', workerId: WORKER_ID });
}, 2000);

const connection = createRedisClient(`bullmq-worker-${WORKER_ID}`);

const worker = new Worker(QUEUE_NAME, async (job: Job) => {
  console.log(`[Worker ${WORKER_HOSTNAME}] Processing job ${job.id} of type ${job.name}...`);
  
  if (process.send) process.send({ type: 'JOB_ACTIVE', jobId: job.id, workerId: WORKER_ID });
  
  const attemptStartTime = new Date();
  const attemptId = `att-${Date.now().toString(36)}`;
  if (process.send) process.send({
    type: 'JOB_ATTEMPT',
    attempt: {
      id: attemptId,
      job_id: job.id!,
      worker_id: WORKER_ID,
      worker_pid: process.pid,
      attempt_number: job.attemptsMade + 1,
      started_at: attemptStartTime.toISOString(),
      status: 'running'
    }
  });
  
  try {
    const { duration = 5000, shouldFail = false } = job.data || {};
    const steps = 10;
    const stepMs = duration / steps;
    
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, stepMs));
      await job.updateProgress(i * 10);
    }
    
    if (shouldFail) {
      throw new Error("Job simulated failure");
    }
    
    const result = { success: true, processedAt: new Date().toISOString() };
    
    if (process.send) process.send({
      type: 'JOB_ATTEMPT',
      attempt: {
        id: attemptId,
        job_id: job.id!,
        worker_id: WORKER_ID,
        worker_pid: process.pid,
        attempt_number: job.attemptsMade + 1,
        started_at: attemptStartTime.toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - attemptStartTime.getTime(),
        status: 'completed'
      }
    });
    
    return result;
  } catch (err: any) {
    if (process.send) process.send({
      type: 'JOB_ATTEMPT',
      attempt: {
        id: attemptId,
        job_id: job.id!,
        worker_id: WORKER_ID,
        worker_pid: process.pid,
        attempt_number: job.attemptsMade + 1,
        started_at: attemptStartTime.toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - attemptStartTime.getTime(),
        status: 'failed',
        error_message: err.message
      }
    });
    throw err;
  }
}, {
  connection: connection as any,
  concurrency
});

worker.on('failed', (job, err) => {
  console.error(`[Worker ${WORKER_HOSTNAME}] Job ${job?.id} failed:`, err.message);
  if (process.send) {
    process.send({ type: 'WORKER_UPDATE', workerId: WORKER_ID, updates: { jobs_failed: (workerNode.jobs_failed || 0) + 1 } });
    workerNode.jobs_failed++;
  }
});

worker.on('completed', (job) => {
  console.log(`[Worker ${WORKER_HOSTNAME}] Job ${job.id} completed successfully`);
  if (process.send) {
    process.send({ type: 'WORKER_UPDATE', workerId: WORKER_ID, updates: { jobs_processed: (workerNode.jobs_processed || 0) + 1 } });
    workerNode.jobs_processed++;
  }
});

process.on('SIGTERM', async () => {
  console.log(`[Worker ${WORKER_HOSTNAME}] Received SIGTERM, shutting down...`);
  if (process.send) process.send({ type: 'WORKER_UPDATE', workerId: WORKER_ID, updates: { status: 'dead' } });
  await worker.close();
  process.exit(0);
});
