import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.js';
import { Navbar } from './components/Navbar.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { LandingPage } from './pages/LandingPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { Dashboard } from './pages/Dashboard.js';
import { WorkersFleet } from './pages/WorkersFleet.js';
import { JobsList } from './pages/JobsList.js';
import { JobDetail } from './pages/JobDetail.js';
import { AuditLogs } from './pages/AuditLogs.js';
import { SubmitJobModal } from './components/SubmitJobModal.js';

export const App: React.FC = () => {
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);

  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans">
          <Navbar onOpenSubmitModal={() => setIsSubmitOpen(true)} />
          
          <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-6">
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />

              {/* Protected Cluster Routes */}
              <Route 
                path="/dashboard" 
                element={
                  <ProtectedRoute>
                    <Dashboard onOpenSubmit={() => setIsSubmitOpen(true)} />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/workers" 
                element={
                  <ProtectedRoute>
                    <WorkersFleet />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/jobs" 
                element={
                  <ProtectedRoute>
                    <JobsList onOpenSubmit={() => setIsSubmitOpen(true)} />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/jobs/:id" 
                element={
                  <ProtectedRoute>
                    <JobDetail />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/logs" 
                element={
                  <ProtectedRoute>
                    <AuditLogs />
                  </ProtectedRoute>
                } 
              />

              {/* Catch-all fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <SubmitJobModal 
            isOpen={isSubmitOpen} 
            onClose={() => setIsSubmitOpen(false)} 
          />
        </div>
      </Router>
    </AuthProvider>
  );
};
