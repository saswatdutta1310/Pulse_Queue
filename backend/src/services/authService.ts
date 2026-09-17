import jwt from 'jsonwebtoken';
import type { User, UserRole } from '../../../shared/types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'pulsequeue-super-secure-secret-key-2026';

export class AuthService {
  private users: Map<string, User> = new Map();

  constructor() {
    // Seed default demo accounts
    const adminUser: User = {
      id: 'usr-admin-evaluator',
      name: 'Judge Evaluator (Admin)',
      email: 'evaluator@synora.internal',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=JudgeAdmin&backgroundColor=0284c7',
      role: 'admin'
    };

    const viewerUser: User = {
      id: 'usr-demo-viewer',
      name: 'Demo Visitor (Viewer)',
      email: 'visitor@pulsequeue.io',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=VisitorDemo&backgroundColor=64748b',
      role: 'viewer'
    };

    this.users.set(adminUser.id, adminUser);
    this.users.set(viewerUser.id, viewerUser);
  }

  public generateToken(user: User): string {
    return jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  public verifyToken(token: string): User | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role as UserRole,
        avatarUrl: decoded.avatarUrl
      };
    } catch {
      return null;
    }
  }

  public createOrUpdateGoogleUser(googlePayload: {
    sub: string;
    name: string;
    email: string;
    picture?: string;
  }): { user: User; token: string } {
    let user = this.users.get(googlePayload.sub);
    if (!user) {
      user = {
        id: googlePayload.sub,
        name: googlePayload.name || 'Google User',
        email: googlePayload.email,
        avatarUrl: googlePayload.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${googlePayload.sub}`,
        // By default, authenticated Google users get admin capabilities for judging/evaluation
        role: 'admin'
      };
      this.users.set(user.id, user);
    }

    const token = this.generateToken(user);
    return { user, token };
  }

  public getDemoSession(role: UserRole = 'admin'): { user: User; token: string } {
    const id = role === 'admin' ? 'usr-admin-evaluator' : 'usr-demo-viewer';
    const user = this.users.get(id)!;
    const token = this.generateToken(user);
    return { user, token };
  }
}

export const authService = new AuthService();
