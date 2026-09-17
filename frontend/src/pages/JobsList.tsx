import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Layers, Search, Filter, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, XCircle, ArrowRight, Play, RotateCcw
} from 'lucide-react';
import { api } from '../services/api.js';
import { getSocket } from '../services/socket.js';
import type { JobRecord, JobStatus } from '../../../shared/types.js';

export const JobsList: React.FC<{ onOpenSubmit: () => void }> = ({ onOpenSubmit }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const data = await api.getJobs({
        status: statusFilter,
        search: searchQuery
      });
      setJobs(data);
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [statusFilter, searchQuery]);

  // Real-time socket updates for jobs
  useEffect(() => {
    const socket = getSocket();

    const handleCreated = (job: JobRecord) => {
      setJobs((prev) => [job, ...prev.filter(j => j.id !== job.id)]);
    };

    const handleUpdated = (job: JobRecord) => {
      setJobs((prev) => prev.map(j => j.id === job.id ? job : j));
    };

    socket.on('job:created', handleCreated);
    socket.on('job:updated', handleUpdated);

    return () => {
      socket.off('job:created', handleCreated);
      socket.off('job:updated', handleUpdated);
    };
  }, []);

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      await api.retryJob(id);
      await fetchJobs();
    } catch (err: any) {
      alert(err.message || 'Retry failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoadingId(id);
    try {
      await api.cancelJob(id);
      await fetchJobs();
    } catch (err: any) {
      alert(err.message || 'Cancel failed');
    } finally {
      setActionLoadingId(null);
    }
  };

  const statusColors: Record<JobStatus, { badge: string; text: string }> = {
    pending: { badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', text: 'Waiting' },
    active: { badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30', text: 'Executing' },
    completed: { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', text: 'Success' },
    failed: { badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20', text: 'Retrying' },
    dead: { badge: 'bg-rose-950/40 text-rose-300 border-rose-500/40', text: 'Dead-Letter' },
    delayed: { badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', text: 'Scheduled' },
    cancelled: { badge: 'bg-slate-800 text-slate-400 border-slate-700', text: 'Cancelled' }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Layers className="h-6 w-6 text-cyan-400" />
            <span>Job Execution Queue</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Durable BullMQ queue states, at-least-once retries, and quarantine inspections
          </p>
        </div>

        <button
          onClick={onOpenSubmit}
          className="flex items-center space-x-1.5 rounded-md bg-cyan-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-cyan-500 active:scale-95 transition-all shadow-sm"
        >
          <Play className="h-3.5 w-3.5 fill-white" />
          <span>Enqueue Task</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-ops-border bg-ops-panel p-3">
        {/* Filter Pills */}
        <div className="flex items-center space-x-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'pending', label: 'Pending' },
            { id: 'completed', label: 'Completed' },
            { id: 'failed', label: 'Failed' },
            { id: 'dead', label: 'Dead-Letter (DLQ)' },
            { id: 'delayed', label: 'Delayed' }
          ].map((item) => {
            const isActive = statusFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setStatusFilter(item.id);
                  setSearchParams(item.id === 'all' ? {} : { status: item.id });
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-mono transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search ID, payload..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-ops-border bg-ops-card pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none font-mono"
          />
        </div>
      </div>

      {/* Jobs Table */}
      <div className="rounded-xl border border-ops-border bg-ops-panel overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-ops-border bg-ops-card/60 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Job ID</th>
                <th className="py-3 px-4 font-semibold">Type</th>
                <th className="py-3 px-4 font-semibold">Progress / Payload</th>
                <th className="py-3 px-4 font-semibold">Attempts</th>
                <th className="py-3 px-4 font-semibold">Submitted</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ops-border/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                    Loading jobs...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                    No matching background jobs found.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const conf = statusColors[job.status] || { badge: 'bg-slate-800 text-slate-300', text: job.status };
                  const isDead = job.status === 'dead';
                  const isFailed = job.status === 'failed';
                  const isActive = job.status === 'active';
                  const isPending = job.status === 'pending';

                  return (
                    <tr 
                      key={job.id} 
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${conf.badge}`}>
                          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping mr-1.5" />}
                          {conf.text}
                        </span>
                      </td>

                      {/* ID */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Link 
                          to={`/jobs/${job.id}`} 
                          className="text-cyan-400 hover:text-cyan-300 hover:underline font-semibold flex items-center space-x-1"
                        >
                          <span>{job.id.substring(0, 8)}...</span>
                          <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </td>

                      {/* Type */}
                      <td className="py-3 px-4 text-slate-200 font-semibold whitespace-nowrap">
                        {job.type}
                      </td>

                      {/* Progress / Payload */}
                      <td className="py-3 px-4 max-w-xs truncate text-slate-400">
                        {isActive ? (
                          <div className="w-36 space-y-1">
                            <div className="flex justify-between text-[10px] text-cyan-400 font-bold">
                              <span>Running</span>
                              <span>{job.progress || 0}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-cyan-400 transition-all duration-200"
                                style={{ width: `${job.progress || 0}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="truncate text-slate-400 text-[11px]">
                            {JSON.stringify(job.payload)}
                          </span>
                        )}
                      </td>

                      {/* Attempts */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={job.attempts > 1 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                          {job.attempts} / {job.max_attempts}
                        </span>
                      </td>

                      {/* Submitted */}
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                        {new Date(job.created_at).toLocaleTimeString()}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end space-x-2">
                          {(isDead || isFailed) && (
                            <button
                              onClick={(e) => handleRetry(job.id, e)}
                              disabled={actionLoadingId === job.id}
                              className="rounded bg-cyan-950/60 border border-cyan-500/40 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-900/60 active:scale-95 transition-all"
                            >
                              <RotateCcw className="h-3 w-3 inline mr-1" />
                              Retry
                            </button>
                          )}
                          {isPending && (
                            <button
                              onClick={(e) => handleCancel(job.id, e)}
                              disabled={actionLoadingId === job.id}
                              className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-700 active:scale-95 transition-all"
                            >
                              Cancel
                            </button>
                          )}
                          <Link
                            to={`/jobs/${job.id}`}
                            className="rounded bg-slate-800/80 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700 transition-colors"
                          >
                            Details
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
