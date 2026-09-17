import type { JobRecord, JobAttempt, WorkerNode, QueueMetrics, JobType, JobPayload } from '../../../shared/types.js';

const BACKEND_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API_BASE = `${BACKEND_URL}/api`;

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('pulsequeue_token');
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) {
    (headers as any)['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.detail || data.error || fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(path: string, options: RequestInit = {}, fallbackError = 'Request failed'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) }
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, fallbackError));
  }
  return res.json();
}

export const api = {
  async getMetrics(): Promise<QueueMetrics> {
    return request<QueueMetrics>('/metrics', {}, 'Failed to fetch metrics');
  },

  async getJobs(params?: { status?: string; type?: string; search?: string }): Promise<JobRecord[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    if (params?.search) query.set('search', params.search);

    return request<JobRecord[]>(`/jobs?${query.toString()}`, {}, 'Failed to fetch jobs');
  },

  async getJob(id: string): Promise<{ job: JobRecord; attempts: JobAttempt[] }> {
    return request<{ job: JobRecord; attempts: JobAttempt[] }>(`/jobs/${id}`, {}, `Job ${id} not found`);
  },

  async createJob(data: {
    type: JobType;
    payload: JobPayload;
    priority?: number;
    maxAttempts?: number;
    backoffMs?: number;
    delayMs?: number;
  }): Promise<JobRecord> {
    return request<JobRecord>('/jobs', {
      method: 'POST',
      body: JSON.stringify(data)
    }, 'Failed to submit job');
  },

  async createBatchJobs(count: number, type: JobType = 'data_sync'): Promise<JobRecord[]> {
    return request<JobRecord[]>('/jobs/batch', {
      method: 'POST',
      body: JSON.stringify({ count, type })
    }, 'Failed to submit batch');
  },

  async retryJob(id: string): Promise<JobRecord> {
    return request<JobRecord>(`/jobs/${id}/retry`, { method: 'POST' }, `Failed to retry job ${id}`);
  },

  async cancelJob(id: string): Promise<{ success: boolean; job: JobRecord }> {
    return request<{ success: boolean; job: JobRecord }>(`/jobs/${id}/cancel`, { method: 'POST' }, `Failed to cancel job ${id}`);
  },

  async getWorkers(): Promise<WorkerNode[]> {
    return request<WorkerNode[]>('/workers', {}, 'Failed to fetch workers');
  },

  async spawnWorker(hostname?: string): Promise<{ id: string; pid: number }> {
    return request<{ id: string; pid: number }>('/workers/spawn', {
      method: 'POST',
      body: JSON.stringify({ hostname })
    }, 'Failed to spawn worker');
  },

  async killWorker(id: string): Promise<{ success: boolean; pid: number }> {
    return request<{ success: boolean; pid: number }>(`/workers/${id}/kill`, { method: 'POST' }, `Failed to kill worker ${id}`);
  },

  async getAuditLogs(): Promise<Array<{ id: string; timestamp: string; action: string; details: any }>> {
    try {
      return await request(`/audit-logs`, {}, 'Failed to fetch audit logs');
    } catch {
      return [];
    }
  },

  async resetAndSeed(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/system/reset-and-seed', {
      method: 'POST'
    }, 'Failed to reset and seed database');
  }
};
