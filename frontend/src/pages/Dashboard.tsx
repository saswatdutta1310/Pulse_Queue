import React, { useState, useEffect } from 'react';
import { 
  Activity, Server, Layers, AlertOctagon, CheckCircle2, 
  RefreshCw, ShieldAlert, Zap, ArrowUpRight, Skull, Terminal, Play
} from 'lucide-react';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid 
} from 'recharts';
import { api } from '../services/api.js';
import { getSocket } from '../services/socket.js';
import type { QueueMetrics, WorkerNode, JobRecord } from '../../../shared/types.js';

interface LogItem {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export const Dashboard: React.FC<{ onOpenSubmit: () => void }> = ({ onOpenSubmit }) => {
  const [metrics, setMetrics] = useState<QueueMetrics>({
    totalJobs: 0,
    pendingJobs: 0,
    activeJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    deadJobs: 0,
    delayedJobs: 0,
    onlineWorkers: 0,
    totalWorkers: 0,
    throughputPerMin: 0,
    avgDurationMs: 0,
    atLeastOnceRecoveries: 0
  });

  const [workers, setWorkers] = useState<WorkerNode[]>([]);
  const [recentJobs, setRecentJobs] = useState<JobRecord[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [chartData, setChartData] = useState<Array<{ time: string; active: number; pending: number; throughput: number }>>([]);
  const [chaosLoading, setChaosLoading] = useState(false);

  // Initial fetch
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [m, w, j] = await Promise.all([
          api.getMetrics(),
          api.getWorkers(),
          api.getJobs()
        ]);
        setMetrics(m);
        setWorkers(w);
        setRecentJobs(j.slice(0, 7));

        // Initial chart point
        const timeStr = new Date().toLocaleTimeString();
        setChartData([
          { time: timeStr, active: m.activeJobs, pending: m.pendingJobs, throughput: m.throughputPerMin }
        ]);
      } catch (err) {
        console.error('Error fetching initial dashboard data:', err);
      }
    };
    fetchData();
  }, []);

  // Socket live subscription
  useEffect(() => {
    const socket = getSocket();

    const handleMetrics = (newMetrics: QueueMetrics) => {
      setMetrics(newMetrics);
      const timeStr = new Date().toLocaleTimeString();
      setChartData((prev) => {
        const updated = [...prev, {
          time: timeStr,
          active: newMetrics.activeJobs,
          pending: newMetrics.pendingJobs,
          throughput: newMetrics.throughputPerMin
        }];
        return updated.slice(-20); // Keep last 20 ticks
      });
    };

    const handleWorkers = (newWorkers: WorkerNode[]) => {
      setWorkers(newWorkers);
    };

    const handleJobCreated = (job: JobRecord) => {
      setRecentJobs((prev) => [job, ...prev.filter(j => j.id !== job.id)].slice(0, 7));
    };

    const handleJobUpdated = (job: JobRecord) => {
      setRecentJobs((prev) => [job, ...prev.filter(j => j.id !== job.id)].slice(0, 7));
    };

    const handleLog = (logData: { timestamp: string; level: 'info' | 'warn' | 'error'; source: string; message: string }) => {
      setLogs((prev) => [
        { id: Math.random().toString(), ...logData },
        ...prev
      ].slice(0, 50));
    };

    socket.on('metrics:update', handleMetrics);
    socket.on('workers:update', handleWorkers);
    socket.on('job:created', handleJobCreated);
    socket.on('job:updated', handleJobUpdated);
    socket.on('log:stream', handleLog);

    return () => {
      socket.off('metrics:update', handleMetrics);
      socket.off('workers:update', handleWorkers);
      socket.off('job:created', handleJobCreated);
      socket.off('job:updated', handleJobUpdated);
      socket.off('log:stream', handleLog);
    };
  }, []);

  // Chaos Test Demo trigger
  const handleChaosDemo = async () => {
    setChaosLoading(true);
    try {
      // 1. Submit 10 jobs
      await api.createBatchJobs(10, 'data_sync');
      
      // 2. Wait 1.5s until jobs are actively claimed
      setTimeout(async () => {
        const currentWorkers = await api.getWorkers();
        const activeWorker = currentWorkers.find(w => w.status === 'online' && w.current_job_id);
        const victim = activeWorker || currentWorkers.find(w => w.status === 'online');
        
        if (victim) {
          await api.killWorker(victim.id);
        }
        setChaosLoading(false);
      }, 1500);
    } catch (err: any) {
      console.error('Chaos demo error:', err);
      setChaosLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>Cluster Telemetry & Fleet State</span>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 pulse-online" />
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Durable BullMQ Engine • Redis In-Flight Tracking • Heartbeat Reaper Active (2.5s)
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleChaosDemo}
            disabled={chaosLoading}
            className="flex items-center space-x-2 rounded-md border border-rose-500/40 bg-rose-950/40 px-3.5 py-2 text-xs font-bold text-rose-300 hover:bg-rose-900/60 active:scale-95 transition-all shadow-sm"
          >
            <Skull className="h-4 w-4 text-rose-400" />
            <span>{chaosLoading ? 'Injecting Chaos...' : 'Trigger Chaos Demo'}</span>
          </button>

          <button
            onClick={onOpenSubmit}
            className="flex items-center space-x-1.5 rounded-md bg-cyan-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-cyan-500 active:scale-95 transition-all shadow-sm border border-cyan-400/40"
          >
            <Play className="h-3.5 w-3.5 fill-white" />
            <span>Enqueue Task</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {/* 1. Queue Depth */}
        <div className="rounded-xl border border-ops-border bg-ops-panel p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400">QUEUE DEPTH</span>
            <Layers className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">
              {metrics.pendingJobs + metrics.activeJobs}
            </span>
            <span className="text-xs text-cyan-400 font-mono">
              ({metrics.activeJobs} active)
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-ops-border/60 pt-2">
            <span>Pending: {metrics.pendingJobs}</span>
            <span>Delayed: {metrics.delayedJobs}</span>
          </div>
        </div>

        {/* 2. Worker Fleet */}
        <div className="rounded-xl border border-ops-border bg-ops-panel p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400">ACTIVE WORKERS</span>
            <Server className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">
              {metrics.onlineWorkers}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              / {metrics.totalWorkers} total
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-ops-border/60 pt-2">
            <span>Liveness: 2.0s pings</span>
            <span className="text-emerald-400">Healthy</span>
          </div>
        </div>

        {/* 3. Completed Jobs */}
        <div className="rounded-xl border border-ops-border bg-ops-panel p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400">COMPLETED</span>
            <CheckCircle2 className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">
              {metrics.completedJobs}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({metrics.throughputPerMin} / min)
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-ops-border/60 pt-2">
            <span>Avg Latency</span>
            <span className="text-white font-mono">{metrics.avgDurationMs}ms</span>
          </div>
        </div>

        {/* 4. Dead-Letter Queue */}
        <div className="rounded-xl border border-ops-border bg-ops-panel p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400">DEAD-LETTER (DLQ)</span>
            <AlertOctagon className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-rose-400 font-mono">
              {metrics.deadJobs}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({metrics.failedJobs} retrying)
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-ops-border/60 pt-2">
            <span>Quarantine</span>
            <span className="text-rose-400">Exhausted</span>
          </div>
        </div>

        {/* 5. At-Least-Once Failovers */}
        <div className="rounded-xl border border-ops-border bg-ops-panel p-4 shadow-sm relative overflow-hidden bg-gradient-to-br from-ops-panel to-emerald-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-emerald-400 font-bold">RESCUED FAILOVERS</span>
            <ShieldAlert className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-emerald-400 font-mono">
              {metrics.atLeastOnceRecoveries}
            </span>
            <span className="text-xs text-emerald-300/80 font-mono">
              jobs rescued
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono border-t border-ops-border/60 pt-2">
            <span>Reclaimed</span>
            <span className="text-emerald-400">Zero Loss</span>
          </div>
        </div>
      </div>

      {/* Real-time Telemetry Graph */}
      <div className="rounded-xl border border-ops-border bg-ops-panel p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Activity className="h-4 w-4 text-cyan-400" />
              <span>Real-Time Job Throughput & Queue Saturation</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">Live dynamic stream from BullMQ orchestrator</p>
          </div>
          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="text-slate-300">Active Jobs</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="text-slate-300">Pending Queue</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="pendingGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} fontVariant="mono" />
              <YAxis stroke="#64748b" fontSize={10} fontVariant="mono" allowDecimals={false} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0f172a', 
                  borderColor: '#1e293b', 
                  borderRadius: '8px', 
                  color: '#fff', 
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }} 
              />
              <Area 
                type="monotone" 
                dataKey="active" 
                stroke="#06b6d4" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#activeGrad)" 
                isAnimationActive={false}
              />
              <Area 
                type="monotone" 
                dataKey="pending" 
                stroke="#f59e0b" 
                strokeWidth={2} 
                fillOpacity={1} 
                fill="url(#pendingGrad)" 
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Split View: Worker Fleet Status & Recent Jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Worker Fleet Quick Cards */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Server className="h-4 w-4 text-emerald-400" />
              <span>Worker Node Fleet</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">{workers.length} nodes</span>
          </div>

          <div className="space-y-3">
            {workers.length === 0 ? (
              <div className="rounded-xl border border-ops-border bg-ops-panel p-6 text-center text-xs text-slate-400">
                No active workers registered.
              </div>
            ) : (
              workers.map((worker) => {
                const isOnline = worker.status === 'online';
                const isKilled = worker.status === 'killed' || worker.status === 'dead';

                return (
                  <div
                    key={worker.id}
                    className={`rounded-xl border p-4 transition-all ${
                      isKilled 
                        ? 'border-rose-500/40 bg-rose-950/20' 
                        : 'border-ops-border bg-ops-panel hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-400 pulse-online' : 'bg-rose-500'}`} />
                        <span className="text-xs font-bold text-white font-mono">{worker.hostname}</span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                          PID {worker.pid}
                        </span>
                      </div>
                      <span className={`text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded ${
                        isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {worker.status}
                      </span>
                    </div>

                    <div className="mt-3">
                      {worker.current_job_id ? (
                        <div className="rounded-md bg-ops-card/80 p-2.5 border border-ops-border/60">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="text-cyan-400 flex items-center space-x-1">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              <span>{worker.current_job_type || 'Processing task'}</span>
                            </span>
                            <span className="text-slate-400">{worker.current_job_progress || 0}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-cyan-400 transition-all duration-300"
                              style={{ width: `${worker.current_job_progress || 0}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-1.5 py-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                          <span>Idle — Waiting for jobs in Redis queue</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Live Terminal Logs */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span>Real-Time Cluster Event Stream</span>
            </h3>
            <span className="text-xs text-slate-400 font-mono">Live WebSocket Push</span>
          </div>

          <div className="rounded-xl border border-ops-border bg-[#070b12] p-4 h-96 overflow-y-auto font-mono text-xs space-y-2">
            {logs.length === 0 ? (
              <div className="text-slate-400 py-8 text-center">
                Waiting for incoming cluster events...
              </div>
            ) : (
              logs.map((log) => {
                const color = 
                  log.level === 'error' ? 'text-rose-400' :
                  log.level === 'warn' ? 'text-amber-400' : 'text-slate-300';

                return (
                  <div key={log.id} className="flex items-start space-x-2 py-0.5 border-b border-slate-900/60">
                    <span className="text-slate-400 select-none whitespace-nowrap text-[11px]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-cyan-400 font-semibold select-none whitespace-nowrap text-[11px]">
                      [{log.source}]
                    </span>
                    <span className={`${color} break-all flex-1`}>
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
