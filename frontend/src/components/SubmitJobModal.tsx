import React, { useState } from 'react';
import { X, Play, Layers, Clock, AlertTriangle, Cpu, Database, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';
import type { JobType } from '../../../shared/types.js';

interface SubmitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const SubmitJobModal: React.FC<SubmitJobModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [jobType, setJobType] = useState<JobType>('data_sync');
  const [priority, setPriority] = useState<number>(5);
  const [delaySec, setDelaySec] = useState<number>(0);
  const [maxAttempts, setMaxAttempts] = useState<number>(3);
  const [backoffMs, setBackoffMs] = useState<number>(2000);
  const [customPayload, setCustomPayload] = useState<string>('{\n  "taskName": "Customer ETL Migration",\n  "itemsCount": 1500,\n  "chunkSize": 100\n}');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [batchCount, setBatchCount] = useState<number>(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTypeSelect = (type: JobType) => {
    setJobType(type);
    setErrorMsg(null);
    switch (type) {
      case 'data_sync':
        setCustomPayload(JSON.stringify({
          taskName: "Database Migration Sync",
          itemsCount: 2000,
          chunkSize: 100,
          sleepMs: 120
        }, null, 2));
        break;
      case 'report_export':
        setCustomPayload(JSON.stringify({
          taskName: "Quarterly Financial Export",
          format: "csv",
          records: 5000,
          sleepMs: 150
        }, null, 2));
        break;
      case 'heavy_computation':
        setCustomPayload(JSON.stringify({
          taskName: "Cryptographic Prime Sieve",
          complexity: 850000,
          sleepMs: 100
        }, null, 2));
        break;
      case 'webhook_dispatch':
        setCustomPayload(JSON.stringify({
          taskName: "Order Confirmation Webhook",
          targetUrl: "https://api.example.com/webhooks/order",
          itemsCount: 1,
          sleepMs: 80
        }, null, 2));
        break;
      case 'fault_simulation':
        setCustomPayload(JSON.stringify({
          taskName: "Payment Gateway Integration",
          shouldFail: true,
          failAtPercent: 60,
          failureMessage: "Connection reset by payment gateway peer during settlement",
          sleepMs: 150
        }, null, 2));
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(customPayload);
      } catch {
        throw new Error('Invalid JSON format in payload');
      }

      await api.createJob({
        type: jobType,
        payload: parsedPayload,
        priority,
        maxAttempts,
        backoffMs,
        delayMs: delaySec * 1000
      });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit job');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchSubmit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await api.createBatchJobs(batchCount, jobType);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit batch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-2xl rounded-xl border border-ops-border bg-ops-panel shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ops-border px-6 py-4 bg-ops-card/50">
          <div className="flex items-center space-x-2">
            <Layers className="h-5 w-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">Enqueue Background Task</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-300 font-mono">
              {errorMsg}
            </div>
          )}

          {/* Job Type Selector */}
          <div>
            <label className="block text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Select Job Handler
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { type: 'data_sync', label: 'Data Sync', icon: Database, desc: 'Batch ETL' },
                { type: 'report_export', label: 'Report Export', icon: FileSpreadsheet, desc: 'CSV & PDF' },
                { type: 'heavy_computation', label: 'CPU Compute', icon: Cpu, desc: 'Prime Sieve' },
                { type: 'webhook_dispatch', label: 'Webhook', icon: RefreshCw, desc: 'HTTP POST' },
                { type: 'fault_simulation', label: 'Fault Simulation', icon: AlertTriangle, desc: 'Retry / DLQ' }
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = jobType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleTypeSelect(item.type as JobType)}
                    className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-950/40 text-white shadow-sm shadow-cyan-950'
                        : 'border-ops-border bg-ops-card/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Icon className={`h-4 w-4 mb-2 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold">{item.label}</span>
                    <span className="text-[10px] text-slate-400">{item.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Priority (1 High - 10 Low)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 5)}
                className="w-full rounded-md border border-ops-border bg-ops-card px-3 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Delay (seconds)
              </label>
              <input
                type="number"
                min="0"
                max="3600"
                value={delaySec}
                onChange={(e) => setDelaySec(parseInt(e.target.value) || 0)}
                className="w-full rounded-md border border-ops-border bg-ops-card px-3 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Max Retries (DLQ threshold)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(parseInt(e.target.value) || 3)}
                className="w-full rounded-md border border-ops-border bg-ops-card px-3 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Backoff Delay (ms)
              </label>
              <input
                type="number"
                step="500"
                min="500"
                max="30000"
                value={backoffMs}
                onChange={(e) => setBackoffMs(parseInt(e.target.value) || 2000)}
                className="w-full rounded-md border border-ops-border bg-ops-card px-3 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Payload Editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono text-slate-400">
                JSON Task Payload
              </label>
              <span className="text-[10px] text-cyan-400 font-mono">Durable schema</span>
            </div>
            <textarea
              rows={5}
              value={customPayload}
              onChange={(e) => setCustomPayload(e.target.value)}
              className="w-full rounded-md border border-ops-border bg-[#070b12] p-3 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none resize-none"
            />
          </div>

          {/* Quick Stress Test Batch */}
          <div className="rounded-lg border border-ops-border bg-ops-card/30 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                <span>Stress Test Batch Dispatch</span>
              </h4>
              <p className="text-[11px] text-slate-400">Distribute tasks concurrently across all running worker nodes.</p>
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <select
                value={batchCount}
                onChange={(e) => setBatchCount(parseInt(e.target.value))}
                className="rounded-md border border-ops-border bg-ops-card px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none"
              >
                <option value={5}>5 Tasks</option>
                <option value={10}>10 Tasks</option>
                <option value={25}>25 Tasks</option>
                <option value={50}>50 Tasks</option>
              </select>
              <button
                type="button"
                onClick={handleBatchSubmit}
                disabled={isSubmitting}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-slate-700 active:scale-95 transition-all border border-cyan-500/30 whitespace-nowrap"
              >
                Launch Batch
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-2 border-t border-ops-border">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-2 rounded-md bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 active:scale-95 transition-all shadow-sm disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-white" />
              <span>{isSubmitting ? 'Dispatching...' : 'Dispatch Task'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
