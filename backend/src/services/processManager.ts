import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '../db/index.js';
import { ENV } from '../config/env.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ProcessManager {
  private workers: Map<string, ChildProcess> = new Map();
  private workerCounter: number = 0;
  private io: any = null;

  public setSocketServer(io: any) {
    this.io = io;
  }

  public async spawnWorker(customName?: string): Promise<{ id: string; pid: number }> {
    const ext = path.extname(__filename);
    const workerScript = path.resolve(__dirname, `../worker/workerRunner${ext}`);
    const workerId = `w-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 4)}`;
    this.workerCounter++;
    const hostname = customName || `worker-node-${this.workerCounter}`;

    console.log(`[ProcessManager] Spawning worker process: ${hostname} (ID: ${workerId})...`);

    const { fork } = await import('child_process');
    const child = fork(workerScript, [], {
      env: {
        ...process.env,
        WORKER_ID: workerId,
        WORKER_HOSTNAME: hostname
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    const pid = child.pid || 0;
    this.workers.set(workerId, child);

    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[${hostname}:${pid}] ${msg}`);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[${hostname}:${pid}:ERR] ${msg}`);
      }
    });

    child.on('message', (msg: any) => {
      if (msg.type === 'WORKER_REGISTER') {
        db.saveWorker(msg.worker);
        if (this.io) this.io.emit('workers:update', db.listWorkers());
      } else if (msg.type === 'WORKER_HEARTBEAT') {
        db.updateWorkerHeartbeat(msg.workerId);
      } else if (msg.type === 'WORKER_UPDATE') {
        const w = db.getWorker(msg.workerId);
        if (w) {
          Object.assign(w, msg.updates);
          db.saveWorker(w);
        }
      } else if (msg.type === 'JOB_ATTEMPT') {
        db.recordAttempt(msg.attempt);
      } else if (msg.type === 'JOB_ACTIVE') {
        db.updateJobStatus(msg.jobId, 'active', { worker_id: msg.workerId });
      }
    });

    child.on('exit', (code, signal) => {
      console.log(`[ProcessManager] Worker ${hostname} (PID: ${pid}) exited [code: ${code}, signal: ${signal}]`);
      this.workers.delete(workerId);
      const w = db.getWorker(workerId);
      if (w && w.status !== 'killed') {
        w.status = 'dead';
        w.current_job_id = undefined;
        w.current_job_type = undefined;
        db.saveWorker(w);
      }
      if (this.io) {
        this.io.emit('workers:update', db.listWorkers());
      }
    });

    return { id: workerId, pid };
  }

  public async killWorker(workerIdOrPid: string | number): Promise<boolean> {
    let targetId = '';
    let targetPid = 0;

    if (typeof workerIdOrPid === 'number') {
      targetPid = workerIdOrPid;
      const workers = db.listWorkers();
      const found = workers.find(w => w.pid === targetPid);
      if (found) targetId = found.id;
    } else {
      targetId = workerIdOrPid;
      const found = db.getWorker(targetId);
      if (found) targetPid = found.pid;
    }

    if (!targetPid) {
      console.warn(`[ProcessManager] Kill requested for unknown worker: ${workerIdOrPid}`);
      return false;
    }

    console.log(`[ProcessManager] ⚡ CHAOS ACTION: Terminating worker PID ${targetPid} (ID: ${targetId})...`);

    // Mark as killed in DB immediately
    const worker = db.getWorker(targetId);
    if (worker) {
      worker.status = 'killed';
      db.saveWorker(worker);
    }

    db.addAuditLog('WORKER_CHAOS_KILLED', {
      workerId: targetId,
      pid: targetPid,
      hostname: worker?.hostname || 'unknown',
      reason: 'Operator triggered chaos injection via Kill Worker button'
    });

    if (this.io) {
      this.io.emit('worker:killed', {
        workerId: targetId,
        pid: targetPid,
        reason: 'Chaos Injection: Worker process terminated by operator via Kill Worker button.'
      });
      this.io.emit('log:stream', {
        timestamp: new Date().toISOString(),
        level: 'warn',
        source: 'ChaosInjection',
        message: `[CHAOS] ⚡ Operator triggered instant SIGKILL on Worker PID ${targetPid} (${worker?.hostname}). Heartbeat timeout → auto-recovery in ~${ENV.MISSED_HEARTBEAT_THRESHOLD_MS / 1000}s.`
      });
      this.io.emit('workers:update', db.listWorkers());
    }

    // Kill the actual OS process (cross-platform)
    const child = this.workers.get(targetId);
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }

    // Also use OS-level kill as fallback
    if (process.platform === 'win32') {
      try {
        await execAsync(`taskkill /F /PID ${targetPid}`);
      } catch {
        // Process may already be dead from child.kill
      }
    } else {
      try {
        process.kill(targetPid, 'SIGKILL');
      } catch {}
    }

    return true;
  }

  public async bootstrapFleet(count: number = ENV.DEFAULT_WORKERS_COUNT) {
    console.log(`[ProcessManager] Bootstrapping fleet of ${count} worker processes...`);
    for (let i = 1; i <= count; i++) {
      await this.spawnWorker(`worker-node-${i}`);
      // Stagger starts so heartbeats don't all fire at the same instant
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[ProcessManager] Fleet of ${count} workers online and consuming jobs.`);
  }

  public shutdownFleet() {
    console.log('[ProcessManager] Terminating all child workers...');
    for (const [id, child] of this.workers.entries()) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    this.workers.clear();
  }
}

export const processManager = new ProcessManager();
