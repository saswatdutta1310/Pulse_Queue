import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireAdmin = false }) => {
  const { isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 max-w-md">
          <h2 className="text-lg font-bold text-rose-400">Access Restricted</h2>
          <p className="text-xs text-slate-400 mt-2">
            This operational control requires Administrator privileges. You are currently authenticated as a Viewer.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
