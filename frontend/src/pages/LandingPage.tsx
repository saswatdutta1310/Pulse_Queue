import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap,
  ShieldCheck,
  Cpu,
  Activity,
  Terminal,
  ArrowRight,
  Play,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Server,
  Lock,
  GitPullRequest
} from 'lucide-react';
import { WeEvolveHero } from '../components/hero/WeEvolveHero.js';
import { GlowCard } from '../components/ui/GlowCard.js';
import { useMagneticRipple } from '../hooks/useMagneticRipple.js';
import { JobLifecycleSection } from '../components/landing/JobLifecycleSection.js';
import { TaglineMarquee } from '../components/landing/TaglineMarquee.js';

export const LandingPage: React.FC = () => {
  const bottomCta = useMagneticRipple<HTMLAnchorElement>();
  // Interactive Chaos Simulation State on the Landing Page
  const [simState, setSimState] = useState<'idle' | 'running' | 'crashed' | 'recovering' | 'recovered'>('idle');
  const [simProgress, setSimProgress] = useState(0);

  const runSimulation = () => {
    setSimState('running');
    setSimProgress(25);

    setTimeout(() => {
      setSimProgress(60);
    }, 1000);

    setTimeout(() => {
      // Simulate crash
      setSimState('crashed');
    }, 2000);

    setTimeout(() => {
      // Reaper detects missed heartbeat
      setSimState('recovering');
    }, 3500);

    setTimeout(() => {
      // Re-assigned and completed
      setSimState('recovered');
      setSimProgress(100);
    }, 5500);
  };

  const resetSimulation = () => {
    setSimState('idle');
    setSimProgress(0);
  };

  return (
    <div className="space-y-24 pb-20">
      <WeEvolveHero />

      <JobLifecycleSection />

      {/* ─── Interactive Failover Sandbox ───────────────────────── */}
      <section className="max-w-4xl mx-auto">
        <div className="rounded-2xl border border-ops-border bg-ops-panel/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ops-border pb-6">
            <div>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-5 w-5 text-cyan-400" />
                <h3 className="text-lg font-bold text-white">Live Failover & Reaper Simulator</h3>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-1">
                See what happens when Worker Node 1 is killed mid-task execution
              </p>
            </div>

            <div className="flex items-center space-x-3">
              {simState === 'idle' ? (
                <button
                  onClick={runSimulation}
                  className="flex items-center space-x-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition-all"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Simulate Worker Crash</span>
                </button>
              ) : (
                <button
                  onClick={resetSimulation}
                  className="flex items-center space-x-2 rounded-lg border border-ops-border bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-all"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Reset Sandbox</span>
                </button>
              )}
            </div>
          </div>

          {/* Interactive Flow Display */}
          <div className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 1: Worker 1 */}
            <div className={`p-4 rounded-xl border transition-all ${
              simState === 'crashed' 
                ? 'border-rose-500/50 bg-rose-950/20' 
                : simState === 'running' 
                  ? 'border-cyan-500/50 bg-cyan-950/20' 
                  : 'border-ops-border bg-ops-card/50'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="font-semibold text-slate-300">Worker Node #1</span>
                {simState === 'crashed' ? (
                  <span className="text-rose-400 font-bold">KILLED (OOM)</span>
                ) : simState === 'running' ? (
                  <span className="text-cyan-400 font-bold animate-pulse">PROCESSING</span>
                ) : (
                  <span className="text-slate-500">STANDBY</span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-mono space-y-1">
                <div>Lease: {simState === 'running' ? 'Active (TTL 2s)' : simState === 'crashed' ? 'EXPIRED' : 'None'}</div>
                <div>Progress: {simProgress}%</div>
              </div>
            </div>

            {/* Step 2: Reaper Watchdog */}
            <div className={`p-4 rounded-xl border transition-all ${
              simState === 'recovering' 
                ? 'border-amber-500/50 bg-amber-950/20' 
                : simState === 'recovered' 
                  ? 'border-emerald-500/50 bg-emerald-950/20' 
                  : 'border-ops-border bg-ops-card/50'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="font-semibold text-slate-300">Heartbeat Reaper</span>
                {simState === 'recovering' ? (
                  <span className="text-amber-400 font-bold animate-pulse">RECLAIMING LEASE</span>
                ) : simState === 'recovered' ? (
                  <span className="text-emerald-400 font-bold">FAILOVER COMPLETE</span>
                ) : (
                  <span className="text-slate-500">MONITORING</span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-mono space-y-1">
                <div>Heartbeat Delta: {simState === 'crashed' ? '5.5s (Exceeded)' : '1.2s (Healthy)'}</div>
                <div>Action: {simState === 'recovering' ? 'Re-queue Task #492' : 'Scanning 2.5s'}</div>
              </div>
            </div>

            {/* Step 3: Worker 2 */}
            <div className={`p-4 rounded-xl border transition-all ${
              simState === 'recovered' 
                ? 'border-emerald-500/50 bg-emerald-950/20' 
                : 'border-ops-border bg-ops-card/50'
            }`}>
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="font-semibold text-slate-300">Worker Node #2</span>
                {simState === 'recovered' ? (
                  <span className="text-emerald-400 font-bold">TASK ACQUIRED</span>
                ) : (
                  <span className="text-slate-500">IDLE</span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-mono space-y-1">
                <div>Outcome: {simState === 'recovered' ? 'Completed 100% (Attempt #2)' : 'Waiting'}</div>
                <div>Data Loss: <span className="text-emerald-400 font-bold">0 Tasks Lost</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Core Architecture Breakdown ───────────────────────── */}
      <section id="architecture" className="max-w-6xl mx-auto space-y-10">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Distributed Systems Architecture
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 font-mono">
            How PulseQueue guarantees delivery, isolation, and high availability
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Zap className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">Distributed Leases & Heartbeats</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Tasks are checked out with a temporary TTL lease renewed every 2 seconds. No permanent locks—if a node dies, the lock expires automatically.
            </p>
          </GlowCard>

          {/* Card 2 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">Sub-6s Reaper Daemon</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Autonomous background monitor checks all nodes every 2.5s. Workers missing 3 heartbeats (&gt;5.5s) are revoked, and tasks are re-queued immediately.
            </p>
          </GlowCard>

          {/* Card 3 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">DLQ & Exponential Backoff</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Poison pill jobs are isolated into the Dead-Letter Queue after 3 failed retries. The main queue never starves, and operators can replay jobs with 1 click.
            </p>
          </GlowCard>

          {/* Card 4 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Activity className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">WebSocket Telemetry Push</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Zero-polling event streaming. Worker memory consumption, queue latency, active progress, and audit trails stream to the UI in real time.
            </p>
          </GlowCard>

          {/* Card 5 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Server className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">Integrated Fleet Orchestrator</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Built-in process manager dynamically spawns or terminates real OS processes. Evaluators can trigger chaos kill tests directly from the dashboard.
            </p>
          </GlowCard>

          {/* Card 6 */}
          <GlowCard className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-white">Google OAuth & RBAC</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Authenticated access via Google Identity and stateless JWTs. Admin users can execute actions; Viewers have read-only telemetry access.
            </p>
          </GlowCard>
        </div>
      </section>

      <TaglineMarquee />

      {/* ─── Bottom CTA ─────────────────────────────────────────── */}
      <section className="text-center pt-8 border-t border-ops-border max-w-2xl mx-auto space-y-4">
        <h2 className="text-2xl font-bold text-white">Ready to Inspect the Engine?</h2>
        <p className="text-xs text-slate-400 font-mono">
          Access the real-time telemetry dashboard, worker fleet, and live audit trail.
        </p>
        <Link
          ref={bottomCta.ref}
          to="/dashboard"
          onMouseMove={bottomCta.onMouseMove}
          onMouseLeave={bottomCta.onMouseLeave}
          onClick={bottomCta.onClick}
          style={bottomCta.style}
          className="relative inline-flex items-center space-x-2 overflow-hidden rounded-full bg-carbon-accent px-6 py-3 text-sm font-semibold text-white shadow-[0_0_25px_var(--carbon-accent-glow)] transition-transform"
        >
          {bottomCta.ripples.map((r) => (
            <span key={r.id} className="cta-ripple" style={{ left: r.x, top: r.y }} />
          ))}
          <span>Open Control Plane</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
};
