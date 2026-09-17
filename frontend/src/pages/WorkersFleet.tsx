import React, { useState, useEffect } from 'react';
import { Server, Plus, Skull, Activity, ShieldCheck, RefreshCw, Cpu, HardDrive } from 'lucide-react';
import { api } from '../services/api.js';
import { getSocket } from '../services/socket.js';
import type { WorkerNode } from '../../../shared/types.js';

export const WorkersFleet: React.FC = () => {
  const [workers, setWorkers] = useState<WorkerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmKillId, setConfirmKillId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Keep a 1s clock for ms since last heartbeat calculation
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchWorkers = async () => {
    try {
      const data = await api.getWorkers();
      setWorkers(data);
    } catch (err) {
      console.error('Error fetching workers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkers();

    const socket = getSocket();
    const handleWorkers = (updated: WorkerNode[]) => {
      setWorkers(updated);
    };

    socket.on('workers:update', handleWorkers);
    return () => {
      socket.off('workers:update', handleWorkers);
    };
  }, []);

  const handleSpawn = async () => {
    setActionLoading(true);
    try {
      await api.spawnWorker();
      await fetchWorkers();
    } catch (err: any) {
      alert(err.message || 'Failed to spawn worker');
    } finally {
      setActionLoading(false);
    }
  };

  const handleKill = async (workerId: string) => {
    if (confirmKillId !== workerId) {
      setConfirmKillId(workerId);
      setTimeout(() => setConfirmKillId(null), 4000);
      return;
    }

    setActionLoading(true);
    try {
      await api.killWorker(workerId);
      setConfirmKillId(null);
      await fetchWorkers();
    } catch (err: any) {
      alert(err.message || 'Failed to kill worker');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Server className="h-6 w-6 text-emerald-400" />
            <span>Distributed Worker Fleet</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Autonomous OS child processes running BullMQ task consumers with 2s heartbeats
          </p>
        </div>

        <button
          onClick={handleSpawn}
          disabled={actionLoading}
          className="flex items-center space-x-2 rounded-md bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 active:scale-95 transition-all shadow-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>Spawn Worker Process</span>
        </button>
      </div>

      {/* Fleet Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-12 text-center text-xs text-slate-400 font-mono">
            Loading worker fleet state...
          </div>
        ) : workers.length === 0 ? (
          <div className="col-span-full rounded-xl border border-ops-border bg-ops-panel p-12 text-center">
            <Server className="mx-auto h-8 w-8 text-slate-400 mb-2" />
            <p className="text-sm font-semibold text-slate-300">No worker processes online</p>
            <p className="text-xs text-slate-400 mt-1">Spawn a worker node to begin processing jobs.</p>
          </div>
        ) : (
          workers.map((worker) => {
            const isOnline = worker.status === 'online';
            const isKilled = worker.status === 'killed' || worker.status === 'dead';
            const elapsedMs = Math.max(0, now - new Date(worker.last_heartbeat).getTime());
            const isConfirming = confirmKillId === worker.id;

            return (
              <div
                key={worker.id}
                className={`rounded-xl border p-5 flex flex-col justify-between transition-all ${
                  isKilled 
                    ? 'border-rose-500/40 bg-rose-950/20' 
                    : 'border-ops-border bg-ops-panel hover:border-slate-700 shadow-sm'
                }`}
              >
                <div>
                  {/* Top line */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-400 pulse-online' : 'bg-rose-500'}`} />
                      <span className="font-bold text-white font-mono text-sm">{worker.hostname}</span>
                    </div>
                    <span className={`text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded ${
                      isOnline 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {worker.status}
                    </span>
                  </div>

                  {/* Metadata line */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono border-y border-ops-border/60 py-2.5 text-slate-400">
                    <div>
                      <span className="text-slate-400">PID: </span>
                      <span className="text-slate-200 font-bold">{worker.pid}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Heartbeat: </span>
                      <span className={elapsedMs > 4000 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                        {isOnline ? `${(elapsedMs / 1000).toFixed(1)}s ago` : 'STOPPED'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Jobs Done: </span>
                      <span className="text-slate-200">{worker.jobs_processed}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Failures: </span>
                      <span className="text-slate-200">{worker.jobs_failed}</span>
                    </div>
                  </div>

                  {/* Active Job status */}
                  <div className="mt-4">
                    <span className="text-[10px] uppercase font-mono font-semibold tracking-wider text-slate-400">
                      In-Flight Execution
                    </span>
                    {worker.current_job_id ? (
                      <div className="mt-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-cyan-400 font-semibold flex items-center space-x-1.5">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>{worker.current_job_type || 'Processing'}</span>
                          </span>
                          <span className="text-slate-300 font-bold">{worker.current_job_progress || 0}%</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cyan-400 transition-all duration-300"
                            style={{ width: `${worker.current_job_progress || 0}%` }}
                          />
                        </div>
                        <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                          ID: {worker.current_job_id}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1.5 rounded-lg border border-ops-border bg-ops-card/40 p-3 text-center text-xs font-mono text-slate-400">
                        Idle (Awaiting jobs from Redis queue)
                      </div>
                    )}
                  </div>
                </div>

                {/* Kill Button (Chaos Injection) */}
                <div className="mt-6 pt-3 border-t border-ops-border/60">
                  {isOnline ? (
                    <button
                      onClick={() => handleKill(worker.id)}
                      disabled={actionLoading}
                      className={`w-full flex items-center justify-center space-x-2 rounded-md py-2 px-3 text-xs font-bold font-mono transition-all ${
                        isConfirming
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'border border-rose-500/30 bg-rose-950/30 text-rose-300 hover:bg-rose-900/50'
                      }`}
                    >
                      <Skull className="h-3.5 w-3.5" />
                      <span>{isConfirming ? `CONFIRM KILL (PID ${worker.pid})?` : 'KILL WORKER (SIGKILL)'}</span>
                    </button>
                  ) : (
                    <div className="text-center text-[11px] font-mono text-rose-400/80 py-1">
                      Process terminated • Reaping handled by Failover Engine
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
