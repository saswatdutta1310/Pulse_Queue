import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Plus, ShieldCheck, LogOut, User as UserIcon, Sparkles } from 'lucide-react';
import { getSocket } from '../../services/socket.js';
import { useAuth } from '../../context/AuthContext.js';
import { useScrollProgress } from '../../hooks/useScrollProgress.js';
import { useMagneticRipple } from '../../hooks/useMagneticRipple.js';
import { PulseLogoMark } from './PulseLogoMark.js';
import { NavDropdown } from './NavDropdown.js';
import type { QueueMetrics } from '../../../../shared/types.js';

interface WeEvolveHeaderProps {
  onOpenSubmitModal: () => void;
}

const NAV_ITEMS: Array<{ path: string; label: string; match: (pathname: string) => boolean; dropdown?: { label: string; path: string }[] }> = [
  { path: '/dashboard', label: 'Telemetry', match: (p) => p === '/dashboard' },
  { path: '/workers', label: 'Worker Fleet', match: (p) => p === '/workers' },
  {
    path: '/jobs',
    label: 'Job Queue',
    match: (p) => p.startsWith('/jobs'),
    dropdown: [
      { label: 'All Jobs', path: '/jobs' },
      { label: 'Active', path: '/jobs?status=active' },
      { label: 'Pending', path: '/jobs?status=pending' },
      { label: 'Dead-Letter (DLQ)', path: '/jobs?status=dead' },
      { label: 'Delayed', path: '/jobs?status=delayed' }
    ]
  },
  { path: '/logs', label: 'Audit & Logs', match: (p) => p === '/logs' }
];

/**
 * Floating glassmorphic pill navigation (WeEvolveIT-style), replacing the
 * old full-width Navbar. Every piece of the old bar's functionality is
 * preserved (auth state, live socket status, rescued-jobs count, enqueue
 * CTA) - just reflowed into the compact pill format.
 */
export const WeEvolveHeader: React.FC<WeEvolveHeaderProps> = ({ onOpenSubmitModal }) => {
  const location = useLocation();
  const { user, isAuthenticated, logout, isAdmin } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const scrollProgress = useScrollProgress();
  const enqueueCta = useMagneticRipple<HTMLButtonElement>();

  useEffect(() => {
    const socket = getSocket();
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleMetrics = (data: QueueMetrics) => setMetrics(data);

    setIsConnected(socket.connected);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('metrics:update', handleMetrics);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('metrics:update', handleMetrics);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* Vertical scroll-progress readout, pinned to the right edge of the viewport */}
      <div className="pointer-events-none fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center space-y-3 sm:flex md:right-6">
        <span
          className="label-mono tabular-nums text-[10px] text-white/40"
          style={{ writingMode: 'vertical-rl' }}
        >
          {String(scrollProgress).padStart(3, '0')}%
        </span>
        <div className="relative h-24 w-px bg-white/10">
          <div
            className="absolute left-0 top-0 w-px bg-carbon-accent transition-[height] duration-150 ease-out"
            style={{ height: `${scrollProgress}%` }}
          />
        </div>
      </div>

      <header className="fixed left-1/2 top-4 z-50 w-[min(94%,1180px)] -translate-x-1/2 md:top-6">
        <div className="flex items-center justify-between gap-2 rounded-[32px] border border-white/10 bg-carbon-glass px-3 py-2 shadow-2xl backdrop-blur-xl md:px-4">
          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center space-x-2.5 pl-1">
            <PulseLogoMark />
            <span className="font-display text-base font-bold tracking-tight text-white">PulseQueue</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center md:flex">
            <Link
              to="/"
              className={`flex items-center space-x-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                location.pathname === '/' ? 'text-white' : 'text-white/55 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Overview</span>
            </Link>
            {NAV_ITEMS.map((item) => (
              <NavDropdown
                key={item.path}
                label={item.label}
                path={item.path}
                items={item.dropdown}
                isActive={item.match(location.pathname)}
              />
            ))}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center space-x-2">
            <div
              className="hidden items-center space-x-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 lg:flex"
              title={isConnected ? 'Live sync connected' : 'Connecting to live sync...'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              {metrics?.atLeastOnceRecoveries ? (
                <span className="label-mono flex items-center space-x-1 text-[10px] text-carbon-accent">
                  <ShieldCheck className="h-3 w-3" />
                  <span>{metrics.atLeastOnceRecoveries} rescued</span>
                </span>
              ) : (
                <span className="label-mono text-[10px] text-white/40">live</span>
              )}
            </div>

            {isAuthenticated && (
              <button
                ref={enqueueCta.ref}
                onMouseMove={enqueueCta.onMouseMove}
                onMouseLeave={enqueueCta.onMouseLeave}
                onClick={(e) => {
                  enqueueCta.onClick(e);
                  onOpenSubmitModal();
                }}
                style={enqueueCta.style}
                className="relative flex items-center space-x-1.5 overflow-hidden rounded-full bg-carbon-accent px-3.5 py-2 text-sm font-semibold text-white shadow-[0_0_20px_var(--carbon-accent-glow)] transition-transform"
              >
                {enqueueCta.ripples.map((r) => (
                  <span key={r.id} className="cta-ripple" style={{ left: r.x, top: r.y }} />
                ))}
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Enqueue</span>
              </button>
            )}

            {isAuthenticated && user ? (
              <div className="hidden items-center space-x-2 pl-1 sm:flex">
                <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full border border-white/10 bg-carbon-card" />
                <span
                  className={`label-mono rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    isAdmin ? 'bg-carbon-accent/20 text-carbon-accent' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {user.role}
                </span>
                <button onClick={logout} title="Sign Out" className="rounded-full p-1.5 text-white/40 transition-colors hover:text-rose-400">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center space-x-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:text-white"
              >
                <UserIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign In</span>
              </Link>
            )}

            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="rounded-full p-2 text-white/70 hover:text-white md:hidden"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        <div
          className={`mt-2 overflow-hidden rounded-[28px] border border-white/10 bg-carbon-glass shadow-2xl backdrop-blur-xl transition-all duration-200 md:hidden ${
            mobileOpen ? 'max-h-[28rem] opacity-100' : 'pointer-events-none max-h-0 opacity-0'
          }`}
        >
          <nav className="flex flex-col p-3">
            <Link to="/" className="rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white">
              Overview
            </Link>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            {!isAuthenticated && (
              <Link to="/login" className="rounded-xl px-3 py-2.5 text-sm font-medium text-carbon-accent hover:bg-white/5">
                Sign In
              </Link>
            )}
            {isAuthenticated && (
              <button
                onClick={logout}
                className="flex items-center space-x-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-rose-400 hover:bg-white/5"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </button>
            )}
          </nav>
        </div>
      </header>
    </>
  );
};
