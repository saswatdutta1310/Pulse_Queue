import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Server, Layers, Terminal, Plus, Cpu, Zap, ShieldCheck, LogOut, Sparkles, User as UserIcon } from 'lucide-react';
import { getSocket } from '../services/socket.js';
import { useAuth } from '../context/AuthContext.js';
import type { QueueMetrics } from '../../../shared/types.js';

interface NavbarProps {
  onOpenSubmitModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSubmitModal }) => {
  const location = useLocation();
  const { user, isAuthenticated, logout, isAdmin } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);

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

  const navLinks = [
    { path: '/dashboard', label: 'Telemetry', icon: Activity },
    { path: '/workers', label: 'Worker Fleet', icon: Server, badge: metrics?.onlineWorkers },
    { path: '/jobs', label: 'Job Queue', icon: Layers, badge: metrics ? metrics.pendingJobs + metrics.activeJobs : undefined },
    { path: '/logs', label: 'Audit & Logs', icon: Terminal }
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-ops-border bg-ops-bg/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-400 group-hover:border-cyan-400 transition-colors">
              <Zap className="h-5 w-5 fill-cyan-400" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold tracking-wider text-white">PulseQueue</span>
                <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-cyan-400 border border-cyan-500/20">
                  CLUSTER v1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Distributed Job Engine</p>
            </div>
          </Link>

          {/* Nav Items */}
          <nav className="hidden md:flex items-center space-x-1">
            <Link
              to="/"
              className={`flex items-center space-x-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                location.pathname === '/'
                  ? 'bg-ops-card text-cyan-400 border border-ops-border'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-4 w-4" />
              <span>Overview</span>
            </Link>

            {navLinks.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-ops-card text-cyan-400 border border-ops-border'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                      isActive ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Info & Actions */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          {/* Socket status */}
          <div className="hidden lg:flex items-center space-x-2 rounded-md bg-ops-panel border border-ops-border px-3 py-1.5 text-xs font-mono">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 pulse-online' : 'bg-rose-500'}`} />
            <span className="text-slate-300">
              {isConnected ? 'LIVE SYNC (WS)' : 'CONNECTING...'}
            </span>
            {metrics?.atLeastOnceRecoveries ? (
              <span className="ml-2 flex items-center space-x-1 text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 rounded px-1.5 py-0.5 text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                <span>{metrics.atLeastOnceRecoveries} recovered</span>
              </span>
            ) : null}
          </div>

          {/* Quick Enqueue Button */}
          {isAuthenticated && (
            <button
              onClick={onOpenSubmitModal}
              className="flex items-center space-x-2 rounded-md bg-cyan-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cyan-500 active:scale-95 transition-all border border-cyan-400/30"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Enqueue Task</span>
            </button>
          )}

          {/* User Auth Profile / Login */}
          {isAuthenticated && user ? (
            <div className="flex items-center space-x-2 pl-2 border-l border-ops-border">
              <div className="flex items-center space-x-2">
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="h-8 w-8 rounded-full border border-cyan-500/30 bg-slate-800"
                />
                <div className="hidden xl:block text-left text-xs font-mono">
                  <div className="text-white font-semibold truncate max-w-[120px]">{user.name}</div>
                  <span className={`text-[10px] px-1 rounded uppercase font-bold ${
                    isAdmin ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {user.role}
                  </span>
                </div>
              </div>

              <button
                onClick={logout}
                title="Sign Out"
                className="p-1.5 rounded-lg border border-ops-border text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center space-x-1.5 rounded-md border border-cyan-500/30 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900/50 transition-all"
            >
              <UserIcon className="h-3.5 w-3.5" />
              <span>Sign In</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

