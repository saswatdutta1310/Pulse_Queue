import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers } from 'lucide-react';
import { getSocket } from '../../services/socket.js';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { useInView } from '../../hooks/useInView.js';
import { useCountUp } from '../../hooks/useCountUp.js';
import { useMagneticRipple } from '../../hooks/useMagneticRipple.js';
import { NodeMarquee } from './NodeMarquee.js';
import type { GlobeMarker } from '../globe/PointCloudGlobe.js';
import type { QueueMetrics, WorkerNode } from '../../../../shared/types.js';

// Lazy/code-split: three.js + the globe scene only load once the hero is
// actually rendered, and never block first paint.
const PointCloudGlobe = React.lazy(() =>
  import('../globe/PointCloudGlobe.js').then((m) => ({ default: m.PointCloudGlobe }))
);

function StatTile({ value, suffix, label }: { value: number; suffix?: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-display text-3xl font-bold tabular-nums text-white sm:text-4xl">
        {value.toLocaleString()}
        {suffix}
      </span>
      <span className="label-mono mt-1 text-[10px] text-white/40">{label}</span>
    </div>
  );
}

export const WeEvolveHero: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [workers, setWorkers] = useState<WorkerNode[] | null>(null);
  const { ref: statsRef, inView: statsInView } = useInView<HTMLDivElement>(0.4);
  const primaryCta = useMagneticRipple<HTMLAnchorElement>();

  // Live metrics - available to every visitor, authenticated or not.
  useEffect(() => {
    const socket = getSocket();
    const handleMetrics = (m: QueueMetrics) => setMetrics(m);
    socket.on('metrics:update', handleMetrics);
    return () => {
      socket.off('metrics:update', handleMetrics);
    };
  }, []);

  // Real worker hostnames only if signed in (the API requires auth); the
  // globe falls back to generic node labels otherwise rather than guessing.
  useEffect(() => {
    if (!isAuthenticated) {
      setWorkers(null);
      return;
    }
    let cancelled = false;
    api.getWorkers().then((w) => { if (!cancelled) setWorkers(w); }).catch(() => {});
    const socket = getSocket();
    const handleWorkersUpdate = (w: WorkerNode[]) => setWorkers(w);
    socket.on('workers:update', handleWorkersUpdate);
    return () => {
      cancelled = true;
      socket.off('workers:update', handleWorkersUpdate);
    };
  }, [isAuthenticated]);

  const markers: GlobeMarker[] = useMemo(() => {
    if (workers && workers.length > 0) {
      return workers.map((w) => ({
        id: w.id,
        label: w.hostname.toUpperCase(),
        online: w.status === 'online'
      }));
    }
    const count = Math.min(6, Math.max(3, metrics?.onlineWorkers ?? 3));
    return Array.from({ length: count }, (_, i) => ({
      id: `placeholder-${i}`,
      label: `NODE-${String(i + 1).padStart(2, '0')}`,
      online: true
    }));
  }, [workers, metrics]);

  const activeWorkers = useCountUp(metrics?.onlineWorkers ?? 0, statsInView);
  const jobsCompleted = useCountUp(metrics?.completedJobs ?? 0, statsInView);
  const recoveries = useCountUp(metrics?.atLeastOnceRecoveries ?? 0, statsInView);
  const avgLatency = useCountUp(metrics?.avgDurationMs ?? 0, statsInView);

  return (
    <section className="relative overflow-hidden pb-16 pt-8">
      {/* Globe fills the hero as a background layer; z-0 keeps it behind
          the content layer so it never steals clicks from the CTAs, while
          its own drag-to-rotate still works everywhere the content isn't. */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-80 sm:pointer-events-auto">
        <Suspense fallback={null}>
          <PointCloudGlobe markers={markers} className="h-[640px] w-full sm:h-[760px]" />
        </Suspense>
      </div>

      <div className="relative z-10 mx-auto max-w-4xl space-y-6 px-2 text-center">
        <div className="label-mono inline-flex items-center space-x-2 rounded-full border border-white/10 bg-carbon-glass px-3.5 py-1 text-[11px] text-white/60 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-online" />
          <span>Autonomous distributed engine · ready</span>
        </div>

        <h1 className="font-display text-[clamp(2.5rem,7vw,5rem)] font-bold leading-[1.02] tracking-tight text-white">
          Zero-loss distributed tasks.
          <br />
          <span className="bg-gradient-to-r from-white to-carbon-accent bg-clip-text text-transparent">
            Autonomous failover &amp; telemetry.
          </span>
        </h1>

        <p className="mx-auto max-w-2xl font-sans text-base leading-relaxed text-white/60 sm:text-lg">
          Engineered for mission-critical enterprise workflows. Built with distributed Redis leases, a
          sub-6-second Heartbeat Reaper, dead-letter queue containment, and real-time WebSocket telemetry.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row">
          <Link
            ref={primaryCta.ref}
            to="/dashboard"
            onMouseMove={primaryCta.onMouseMove}
            onMouseLeave={primaryCta.onMouseLeave}
            onClick={primaryCta.onClick}
            style={primaryCta.style}
            className="relative inline-flex w-full items-center justify-center space-x-2 overflow-hidden rounded-full bg-carbon-accent px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_var(--carbon-accent-glow)] transition-transform sm:w-auto"
          >
            {primaryCta.ripples.map((r) => (
              <span key={r.id} className="cta-ripple" style={{ left: r.x, top: r.y }} />
            ))}
            <span>Launch Live Control Plane</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#architecture"
            className="inline-flex w-full items-center justify-center space-x-2 rounded-full border border-white/15 bg-carbon-glass px-6 py-3.5 text-sm font-semibold text-white/80 backdrop-blur-md transition-colors hover:text-white sm:w-auto"
          >
            <Layers className="h-4 w-4 text-carbon-accent" />
            <span>Explore Architecture</span>
          </a>
        </div>

        {/* Live stats - real metrics, animate in once on first scroll-into-view */}
        <div
          ref={statsRef}
          className="mx-auto flex max-w-2xl flex-wrap items-start justify-center gap-x-10 gap-y-6 pt-10"
        >
          <StatTile value={activeWorkers} label="Active Workers" />
          <StatTile value={jobsCompleted} label="Jobs Completed" />
          <StatTile value={recoveries} label="Zero-Loss Recoveries" />
          <StatTile value={avgLatency} suffix="ms" label="Avg. Execution" />
        </div>

        <div className="pt-4">
          <NodeMarquee />
        </div>
      </div>
    </section>
  );
};
