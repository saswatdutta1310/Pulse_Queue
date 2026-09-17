import { io, Socket } from 'socket.io-client';
import type { QueueMetrics, WorkerNode, JobRecord } from '../../../shared/types.js';

const BACKEND_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') || '/';
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected to PulseQueue backend live telemetry:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected from live stream:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }

  return socket;
}
