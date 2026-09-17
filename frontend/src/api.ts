import { io, Socket } from 'socket.io-client';
import type { JobRecord, WorkerNode, QueueMetrics } from '../../shared/types';

const API_BASE = 'http://localhost:4000/api';
export const socket: Socket = io('http://localhost:4000');

export const api = {
  getMetrics: async (): Promise<QueueMetrics> => {
    const res = await fetch(`${API_BASE}/metrics`);
    return res.json();
  },
  
  getJobs: async (filters?: { status?: string; type?: string; search?: string }): Promise<JobRecord[]> => {
    const params = new URLSearchParams(filters as any).toString();
    const res = await fetch(`${API_BASE}/jobs?${params}`);
    return res.json();
  },
  
  enqueueJob: async (job: { type: string; payload: any; priority?: number; maxAttempts?: number }): Promise<JobRecord> => {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  
  retryJob: async (id: string): Promise<JobRecord> => {
    const res = await fetch(`${API_BASE}/jobs/${id}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  
  cancelJob: async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  },
  
  getWorkers: async (): Promise<WorkerNode[]> => {
    const res = await fetch(`${API_BASE}/workers`);
    return res.json();
  },
  
  spawnWorker: async (concurrency: number = 1): Promise<{ id: string; pid: number }> => {
    const res = await fetch(`${API_BASE}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  
  killWorker: async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/workers/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  },
  
  getAuditLogs: async (): Promise<any[]> => {
    const res = await fetch(`${API_BASE}/audit-logs`);
    return res.json();
  }
};
