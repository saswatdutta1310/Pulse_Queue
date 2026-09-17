import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ENV } from './config/env.js';
import { queueService } from './services/queueService.js';
import { processManager } from './services/processManager.js';
import { heartbeatReaper } from './services/heartbeatReaper.js';
import { db } from './db/index.js';
import { authService } from './services/authService.js';
import { requireAuth, requireRole, AuthenticatedRequest } from './middleware/authMiddleware.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());

// Wire socket.io to all services
queueService.setSocketServer(io);
heartbeatReaper.setSocketServer(io);
processManager.setSocketServer(io);

// ─── Authentication Endpoints ───────────────────────────────

// Verify Google Token or Payload
app.post('/api/auth/google', (req, res) => {
  try {
    const { sub, name, email, picture } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required from Google credential' });
    }
    const session = authService.createOrUpdateGoogleUser({
      sub: sub || `g-${Date.now()}`,
      name: name || 'Google User',
      email,
      picture
    });
    db.addAuditLog('USER_LOGIN_GOOGLE', { email, name: session.user.name, role: session.user.role });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fast 1-Click Demo Evaluation Login (Admin or Viewer)
app.post('/api/auth/demo', (req, res) => {
  try {
    const { role = 'admin' } = req.body;
    const session = authService.getDemoSession(role);
    db.addAuditLog('USER_LOGIN_DEMO', { name: session.user.name, role });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Current User Profile Check
app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

// ─── Health & Liveness Probe ────────────────────────────────
app.get('/health/liveness', (_req, res) => {
  const isHealthy = heartbeatReaper.isHealthy();
  if (isHealthy) {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), reaper: 'active' });
  } else {
    res.status(503).json({ status: 'unhealthy', error: 'Heartbeat Reaper watchdog stalled' });
  }
});

// ─── Metrics ────────────────────────────────────────────────

app.get('/api/metrics', (_req, res) => {
  res.json(db.getMetrics());
});


// ─── Jobs ───────────────────────────────────────────────────

// List jobs (filterable)
app.get('/api/jobs', (req, res) => {
  const { status, type, search } = req.query;
  const jobs = db.listJobs({
    status: status as string,
    type: type as string,
    search: search as string
  });
  res.json(jobs);
});

// Get single job detail with attempts
app.get('/api/jobs/:id', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const attempts = db.getAttempts(req.params.id);
  res.json({ job, attempts });
});

// Submit single job
app.post('/api/jobs', async (req, res) => {
  try {
    const { type, payload, priority, maxAttempts, backoffMs, delayMs } = req.body;
    if (!type || !payload) {
      return res.status(400).json({ error: 'Type and payload are required' });
    }
    const job = await queueService.enqueueJob({ type, payload, priority, maxAttempts, backoffMs, delayMs });
    res.status(201).json(job);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit batch of jobs
app.post('/api/jobs/batch', async (req, res) => {
  try {
    const { count = 10, type = 'data_sync' } = req.body;
    const jobNames: Record<string, string[]> = {
      data_sync: ['Customer ETL Migration', 'Order History Sync', 'User Profile Reindex', 'Inventory Reconciliation', 'Session Data Cleanup'],
      report_export: ['Quarterly Revenue Report', 'User Analytics Export', 'Compliance Audit Sheet', 'Marketing Metrics CSV'],
      heavy_computation: ['Prime Sieve Computation', 'Hash Chain Generation', 'Matrix Multiplication', 'Fibonacci Sequence'],
      fault_simulation: ['Payment Gateway Integration', 'External API Webhook', 'Database Failover Test', 'Network Timeout Simulation']
    };
    const names = jobNames[type] || jobNames.data_sync;

    const jobs = [];
    for (let i = 0; i < count; i++) {
      const taskName = names[i % names.length] + ` #${i + 1}`;
      const isFault = type === 'fault_simulation';
      const job = await queueService.enqueueJob({
        type,
        payload: {
          taskName,
          itemsCount: Math.floor(Math.random() * 2000) + 500,
          sleepMs: Math.floor(Math.random() * 100) + 80,
          shouldFail: isFault,
          failAtPercent: isFault ? 40 + Math.floor(Math.random() * 40) : undefined,
          failureMessage: isFault ? 'Simulated transient failure during batch processing' : undefined
        },
        priority: 5 + Math.floor(Math.random() * 3),
        maxAttempts: isFault ? 3 : 3
      });
      jobs.push(job);
    }
    res.status(201).json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retry a failed/dead job
app.post('/api/jobs/:id/retry', async (req, res) => {
  try {
    const job = await queueService.retryJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a pending/delayed job
app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const success = await queueService.cancelJob(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also support DELETE for cancel
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const success = await queueService.cancelJob(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Workers ────────────────────────────────────────────────

// List workers
app.get('/api/workers', (_req, res) => {
  res.json(db.listWorkers());
});

// Spawn worker (POST /api/workers/spawn)
app.post('/api/workers/spawn', async (req, res) => {
  try {
    const { hostname } = req.body || {};
    const result = await processManager.spawnWorker(hostname);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also support POST /api/workers for spawning (legacy compat)
app.post('/api/workers', async (req, res) => {
  try {
    const { concurrency } = req.body || {};
    const result = await processManager.spawnWorker(concurrency);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Kill worker (POST /api/workers/:id/kill)
app.post('/api/workers/:id/kill', async (req, res) => {
  try {
    const success = await processManager.killWorker(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    const worker = db.getWorker(req.params.id);
    res.json({ success: true, pid: worker?.pid || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also support DELETE for kill (legacy compat)
app.delete('/api/workers/:id', async (req, res) => {
  try {
    const success = await processManager.killWorker(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Worker not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Audit Logs ─────────────────────────────────────────────
app.get('/api/audit-logs', (_req, res) => {
  res.json(db.getAuditLogs());
});

// ─── Socket.io ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  // Send full initial state
  socket.emit('metrics:update', db.getMetrics());
  socket.emit('workers:update', db.listWorkers());

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

// ─── Periodic metrics broadcast (supplement socket events) ──
setInterval(() => {
  io.emit('metrics:update', db.getMetrics());
  io.emit('workers:update', db.listWorkers());
}, 2000);

// ─── Start Server ───────────────────────────────────────────
const PORT = ENV.PORT || 4000;
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  PulseQueue Core Engine — Port ${PORT}      ║`);
  console.log(`  ║  Redis: ${ENV.REDIS_HOST}:${ENV.REDIS_PORT}              ║`);
  console.log(`  ║  Heartbeat Reaper: ON (${ENV.REAPER_INTERVAL_MS}ms)       ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);

  // Start heartbeat reaper daemon
  heartbeatReaper.start();

  // Auto-bootstrap 3 worker processes
  processManager.bootstrapFleet(3);
});

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  heartbeatReaper.stop();
  processManager.shutdownFleet();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Server] Received SIGTERM...');
  heartbeatReaper.stop();
  processManager.shutdownFleet();
  process.exit(0);
});
