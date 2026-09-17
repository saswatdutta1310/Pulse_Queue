import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User, UserRole } from '../../../shared/types.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loginWithGoogle: (credentialResponse: any) => Promise<void>;
  loginAsDemo: (role?: UserRole) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY_USER = 'pulsequeue_user';
const STORAGE_KEY_TOKEN = 'pulsequeue_token';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_USER);
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_TOKEN);
  });

  const setSession = (newUser: User, newToken: string) => {
    setUser(newUser);
    setToken(newToken);
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser));
    localStorage.setItem(STORAGE_KEY_TOKEN, newToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  };

  const loginWithGoogle = async (credentialResponse: any) => {
    try {
      // Decode JWT payload from Google Identity Services credential response
      let payload: any = {};
      if (credentialResponse.credential) {
        const parts = credentialResponse.credential.split('.');
        if (parts.length === 3) {
          payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        }
      }

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sub: payload.sub || `g-${Date.now()}`,
          name: payload.name || 'Google Evaluator',
          email: payload.email || 'evaluator@google.com',
          picture: payload.picture
        })
      });

      if (!res.ok) throw new Error('Google Authentication failed on server');
      const data = await res.json();
      setSession(data.user, data.token);
    } catch (err: any) {
      console.error('Google login error:', err);
      throw err;
    }
  };

  const loginAsDemo = async (role: UserRole = 'admin') => {
    try {
      const res = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      if (!res.ok) throw new Error('Demo login failed');
      const data = await res.json();
      setSession(data.user, data.token);
    } catch (err: any) {
      console.error('Demo login error:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isAdmin: user?.role === 'admin',
        loginWithGoogle,
        loginAsDemo,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
