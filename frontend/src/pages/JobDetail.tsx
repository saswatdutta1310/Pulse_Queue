import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, RotateCcw, AlertTriangle, CheckCircle2, Clock, 
  Server, ShieldAlert, Terminal, Copy, Check, Layers, Cpu
} from 'lucide-react';
import { api } from '../services/api.js';
import type { JobRecord, JobAttempt, JobStatus } from '../../../shared/types.js';

export const JobDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [attempts, setAttempts] = useState<JobAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchJobData = async () => {
    if (!id) return;
    try {
      const data = await api.getJob(id);
      setJob(data.job);
      setAttempts(data.attempts);
    } catch (err) {
      console.error('Failed to load job details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobData();
    const interval = setInterval(fetchJobData, 2000); // Live poll for active job updates
    return () => clearInterval(interval);
  }, [id]);

  const handleRetry = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      await api.retryJob(id);
      await fetchJobData();
    } catch (err: any) {
      alert(err.message || 'Retry failed');
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="py-24 text-center text-xs font-mono text-slate-400">
        Loading execution telemetry for job {id}...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm font-bold text-slate-300">Job Not Found</p>
        <Link to="/jobs" className="text-xs text-cyan-400 hover:underline mt-2 inline-block">
          Return to Queue
        </Link>
      </div>
    );
  }

  const isDead = job.status === 'dead';
  const isFailed = job.status === 'failed';

  return (
    <div className="space-y-6 pb-16 max-w-5xl mx-auto">
      {/* Back Button & Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-white font-mono transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Jobs</span>
        </button>

        {(isDead || isFailed) && (
          <button
            onClick={handleRetry}
            disabled={actionLoading}
            className="flex items-center space-x-2 rounded-md bg-cyan-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 active:scale-95 transition-all shadow-sm"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Retry Job Execution</span>
          </button>
        )}
      </div>

      {/* Main Metadata Card */}
      <div className="rounded-xl border border-ops-border bg-ops-panel p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ops-border/60 pb-5">
          <div>
            <div className="flex items-center space-x-3">
              <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase font-mono border ${
                job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                job.status === 'active' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' :
                job.status === 'dead' ? 'bg-rose-950/40 text-rose-300 border-rose-500/40' :
                'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {job.status}
              </span>
              <h2 className="text-lg font-bold text-white font-mono">{job.type}</h2>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Job ID: <span className="text-slate-300">{job.id}</span>
            </p>
          </div>

          <div className="flex items-center space-x-6 text-xs font-mono text-slate-400">
            <div>
              <span className="block text-[10px] text-slate-400">ATTEMPTS</span>
              <span className="font-bold text-white text-sm">{job.attempts} / {job.max_attempts}</span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-400">PRIORITY</span>
              <span className="font-bold text-white text-sm">{job.priority}</span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-400">BACKOFF</span>
              <span className="font-bold text-white text-sm">{job.backoff_ms}ms</span>
            </div>
          </div>
        </div>

        {/* Payload and Result */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <span className="text-[11px] font-mono text-slate-400 block mb-1.5 font-semibold">
              Input Payload (JSON)
            </span>
            <pre className="rounded-lg border border-ops-border bg-[#070b12] p-3 text-xs font-mono text-slate-300 overflow-x-auto">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>

          <div>
            <span className="text-[11px] font-mono text-slate-400 block mb-1.5 font-semibold">
              Execution Result
            </span>
            <pre className="rounded-lg border border-ops-border bg-[#070b12] p-3 text-xs font-mono text-slate-300 overflow-x-auto">
              {job.result ? JSON.stringify(job.result, null, 2) : '// No result output yet (in queue or failed)'}
            </pre>
          </div>
        </div>
      </div>

      {/* Execution Attempt History (Timeline) */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2 font-mono">
          <Clock className="h-4 w-4 text-cyan-400" />
          <span>Execution Attempt Audit Trail</span>
        </h3>

        {attempts.length === 0 ? (
          <div className="rounded-xl border border-ops-border bg-ops-panel p-6 text-center text-xs text-slate-400 font-mono">
            No execution attempts recorded yet.
          </div>
        ) : (
          attempts.map((attempt) => {
            const isKilled = attempt.status === 'worker_killed';
            const isSuccess = attempt.status === 'completed';

            return (
              <div
                key={attempt.id}
                className={`rounded-xl border p-5 space-y-4 transition-all ${
                  isKilled 
                    ? 'border-amber-500/40 bg-amber-950/20' 
                    : isSuccess 
                    ? 'border-emerald-500/30 bg-ops-panel' 
                    : 'border-rose-500/40 bg-rose-950/20'
                }`}
              >
                {/* Attempt Header */}
                <div className="flex items-center justify-between border-b border-ops-border/60 pb-3">
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-bold text-white font-mono bg-slate-800 px-2.5 py-1 rounded">
                      Attempt #{attempt.attempt_number}
                    </span>
                    <span className={`text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded ${
                      isSuccess ? 'bg-emerald-500/20 text-emerald-400' :
                      isKilled ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                      'bg-rose-500/20 text-rose-300'
                    }`}>
                      {isKilled ? 'WORKER KILLED (AUTO-RECLAIMED)' : attempt.status}
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 text-xs font-mono text-slate-400">
                    {attempt.duration_ms !== undefined && (
                      <span>Duration: <strong className="text-slate-200">{attempt.duration_ms}ms</strong></span>
                    )}
                    {attempt.worker_pid && (
                      <span className="text-cyan-400">PID: {attempt.worker_pid}</span>
                    )}
                  </div>
                </div>

                {/* Error Box & Stack Trace */}
                {attempt.stack_trace && (
                  <div className="rounded-lg border border-ops-border bg-[#070b12] p-4 font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between text-rose-400 font-bold">
                      <span className="flex items-center space-x-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{attempt.error_code || 'EXECUTION_FAILURE'}</span>
                      </span>
                      <button
                        onClick={() => copyToClipboard(attempt.stack_trace || '')}
                        className="text-slate-400 hover:text-white flex items-center space-x-1 text-[10px]"
                      >
                        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        <span>{copied ? 'Copied' : 'Copy Trace'}</span>
                      </button>
                    </div>

                    <p className="text-slate-300 text-xs">{attempt.error_message}</p>
                    
                    <pre className="text-[11px] text-slate-400 overflow-x-auto pt-2 border-t border-slate-900 leading-relaxed">
                      {attempt.stack_trace}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
