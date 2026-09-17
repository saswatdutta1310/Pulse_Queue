import React, { useEffect, useRef, useState } from 'react';
import { Activity, Layers, Lock, RefreshCw, ShieldCheck } from 'lucide-react';

// Accurate to the actual backend implementation (redis_service.py,
// worker_process.py, reaper.py) - not generic marketing copy. The timing
// numbers (1.5s heartbeat, 5.5s failover window) are the real configured
// values, not invented for effect.
const STEPS = [
  {
    n: '01',
    title: 'Enqueued',
    icon: Layers,
    body: 'The job lands in a Redis priority queue, scored by priority and submission time - highest priority, oldest first.',
    statLabel: 'Queue key',
    statValue: 'pq:wait'
  },
  {
    n: '02',
    title: 'Claimed',
    icon: Lock,
    body: 'A worker atomically dequeues it via a Lua script and claims a monotonic lease epoch. No two workers can ever hold the same job.',
    statLabel: 'Lease epoch',
    statValue: '1'
  },
  {
    n: '03',
    title: 'Executing',
    icon: Activity,
    body: 'The worker processes the job while a background thread renews its heartbeat independently, every 1.5 seconds.',
    statLabel: 'Heartbeat interval',
    statValue: '1.5s'
  },
  {
    n: '04',
    title: 'Verified',
    icon: ShieldCheck,
    body: "Before committing a result, the worker's epoch is checked against Redis. A stale or zombie commit is rejected outright.",
    statLabel: 'Fencing check',
    statValue: 'GET job:epoch:<id>'
  },
  {
    n: '05',
    title: 'Resolved',
    icon: RefreshCw,
    body: 'The job completes - or if the worker crashed, the Reaper reassigns it within 5.5 seconds. Zero data loss, either way.',
    statLabel: 'Failover window',
    statValue: '< 5.5s'
  }
] as const;

export const JobLifecycleSection: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Which step is "active" is computed as whichever step's center is
  // closest to the viewport's vertical center, recalculated on every scroll
  // frame. An IntersectionObserver with a thin center "hot band" was tried
  // first, but a fast scroll (flick, Page Down, or a big jump) can skip
  // straight over that band between frames and never register a step as
  // intersecting at all - this closest-to-center approach can't miss a step
  // that way, since it re-evaluates all of them on every frame regardless.
  useEffect(() => {
    let ticking = false;

    const updateActive = () => {
      ticking = false;
      const viewportCenter = window.innerHeight / 2;
      let closestIndex = 0;
      let closestDistance = Infinity;

      stepRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      });

      setActiveIndex(closestIndex);
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateActive);
      }
    };

    updateActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const active = STEPS[activeIndex];
  const ActiveIcon = active.icon;

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-12 space-y-2 text-center">
        <span className="label-mono text-xs text-carbon-accent">How a job survives</span>
        <h2 className="font-display text-3xl font-bold text-white sm:text-4xl">The Lifecycle of a Job</h2>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Sticky visual panel - desktop only; the mobile layout inlines a
            small icon per step instead (a persistent side panel doesn't
            translate to narrow viewports). */}
        <div className="hidden lg:block">
          <div className="sticky top-32 overflow-hidden rounded-2xl border border-white/10 bg-carbon-card p-8">
            <div className="flex items-center justify-between">
              <span className="font-display text-6xl font-bold text-white/10">{active.n}</span>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-carbon-accent/20 bg-carbon-accent/10 text-carbon-accent">
                <ActiveIcon className="h-6 w-6" />
              </div>
            </div>
            <h3 className="mt-6 font-display text-2xl font-bold text-white">{active.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/50">{active.body}</p>
            <div className="mt-8 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="label-mono mb-1 text-[10px] text-white/30">{active.statLabel}</div>
              <div className="font-mono text-sm text-carbon-accent">{active.statValue}</div>
            </div>
            <div className="mt-8 flex items-center space-x-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s.n}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    i <= activeIndex ? 'bg-carbon-accent' : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Scrolling step list */}
        <div className="space-y-[26vh] py-[8vh] lg:space-y-[46vh]">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === activeIndex;
            return (
              <div
                key={step.n}
                ref={(el) => {
                  stepRefs.current[i] = el;
                }}
              >
                <div
                  className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl border transition-colors lg:hidden ${
                    isActive ? 'border-carbon-accent/30 bg-carbon-accent/10 text-carbon-accent' : 'border-white/10 bg-white/5 text-white/40'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className={`transition-opacity duration-500 ${isActive ? 'opacity-100' : 'opacity-30 lg:opacity-40'}`}>
                  <span className="label-mono text-xs text-carbon-accent">{step.n}</span>
                  <h3 className="mt-2 font-display text-2xl font-bold text-white sm:text-3xl">{step.title}</h3>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-white/50 sm:text-base">{step.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
