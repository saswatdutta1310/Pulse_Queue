import React, { useState, useEffect } from 'react';
import { Terminal, Shield, RefreshCw, Layers } from 'lucide-react';
import { api } from '../services/api.js';

export const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<Array<{ id: string; timestamp: string; action: string; details: any }>>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const data = await api.getAuditLogs();
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Shield className="h-6 w-6 text-cyan-400" />
            <span>Audit Trail & Historical Actions</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Cryptographically logged orchestrator events, failover triggers, and manual operator actions
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="flex items-center space-x-1.5 rounded-md bg-ops-panel border border-ops-border px-3 py-1.5 text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-all"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Logs Table */}
      <div className="rounded-xl border border-ops-border bg-ops-panel overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-ops-border bg-ops-card/60 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4 font-semibold">Timestamp</th>
                <th className="py-3 px-4 font-semibold">Action</th>
                <th className="py-3 px-4 font-semibold">Details & Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ops-border/60">
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400 font-mono">
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400 font-mono">
                    No audit records logged yet.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isReassigned = log.action === 'JOB_AUTO_REASSIGNED';
                  const isManual = log.action === 'JOB_MANUAL_RETRY';

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isReassigned 
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' 
                            : isManual
                            ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {log.action}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-slate-300 text-[11px] font-mono">
                        <pre className="inline-block bg-[#070b12] px-2 py-1 rounded border border-ops-border max-w-xl truncate">
                          {JSON.stringify(log.details)}
                        </pre>
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
