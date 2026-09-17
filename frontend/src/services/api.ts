import type { JobRecord, JobAttempt, WorkerNode, QueueMetrics, JobType, JobPayload } from '../../../shared/types.js';

const API_BASE = '/api';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('pulsequeue_token');
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) {
    (headers as any)['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export const api = {
  async getMetrics(): Promise<QueueMetrics> {
    const res = await fetch(`${API_BASE}/metrics`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },


  async getJobs(params?: { status?: string; type?: string; search?: string }): Promise<JobRecord[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.search) query.set('search', params.search);
    
    const res = await fetch(`${API_BASE}/jobs?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch jobs');
    return res.json();
  },

  async getJob(id: string): Promise<{ job: JobRecord; attempts: JobAttempt[] }> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${id}`);
      if (res.ok) {
        const data = await res.json();
        // If backend returned just the job or { job, attempts }
        if (data && data.job) return data;
        return { job: data, attempts: data.attempts || [] };
      }
    } catch {}

    // Resilient fallback: lookup in list
    const jobs = await this.getJobs();
    const found = jobs.find(j => j.id === id);
    if (!found) throw new Error(`Job ${id} not found`);
    return { job: found, attempts: [] };
  },

  async createJob(data: {
    type: JobType;
    payload: JobPayload;
    priority?: number;
    maxAttempts?: number;
    backoffMs?: number;
    delayMs?: number;
  }): Promise<JobRecord> {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to submit job');
    return res.json();
  },

  async createBatchJobs(count: number, type: JobType = 'data_sync'): Promise<JobRecord[]> {
    try {
      const res = await fetch(`${API_BASE}/jobs/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, type })
      });
      if (res.ok) return res.json();
    } catch {}

    // Resilient fallback: dispatch concurrently
    const promises: Promise<JobRecord>[] = [];
    for (let i = 1; i <= count; i++) {
      promises.push(
        this.createJob({
          type,
          payload: {
            taskName: `Batch Item #${i}`,
            itemsCount: 1000,
            sleepMs: 100
          },
          priority: 5,
          maxAttempts: 3
        })
      );
    }
    return Promise.all(promises);
  },

  async retryJob(id: string): Promise<JobRecord> {
    const res = await fetch(`${API_BASE}/jobs/${id}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to retry job ${id}`);
    return res.json();
  },

  async cancelJob(id: string): Promise<{ success: boolean }> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) return res.json();
    } catch {}

    const res2 = await fetch(`${API_BASE}/jobs/${id}/cancel`, { method: 'POST' });
    if (!res2.ok) throw new Error(`Failed to cancel job ${id}`);
    return res2.json();
  },

  async getWorkers(): Promise<WorkerNode[]> {
    const res = await fetch(`${API_BASE}/workers`);
    if (!res.ok) throw new Error('Failed to fetch workers');
    return res.json();
  },

  async spawnWorker(hostname?: string): Promise<{ id: string; pid: number }> {
    try {
      const res = await fetch(`${API_BASE}/workers/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname })
      });
      if (res.ok) return res.json();
    } catch {}

    const res2 = await fetch(`${API_BASE}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 1 })
    });
    if (!res2.ok) throw new Error('Failed to spawn worker');
    return res2.json();
  },

  async killWorker(id: string): Promise<{ success: boolean; pid: number }> {
    try {
      const res = await fetch(`${API_BASE}/workers/${id}/kill`, { method: 'POST' });
      if (res.ok) return res.json();
    } catch {}

    const res2 = await fetch(`${API_BASE}/workers/${id}`, { method: 'DELETE' });
    if (!res2.ok) throw new Error(`Failed to kill worker ${id}`);
    return res2.json();
  },

  async getAuditLogs(): Promise<Array<{ id: string; timestamp: string; action: string; details: any }>> {
    const res = await fetch(`${API_BASE}/audit-logs`);
    if (!res.ok) return [];
    return res.json();
  }
};
