import { Redis } from 'ioredis';
import { ENV } from './env.js';

export function createRedisClient(role: string = 'client'): Redis {
  const client = new Redis({
    host: ENV.REDIS_HOST,
    port: ENV.REDIS_PORT,
    password: ENV.REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    }
  });

  client.on('error', (err: Error) => {
    console.error(`[Redis:${role}] Connection Error:`, err.message);
  });

  client.on('connect', () => {
    console.log(`[Redis:${role}] Connected successfully to ${ENV.REDIS_HOST}:${ENV.REDIS_PORT}`);
  });

  return client;
}

// Shared singleton for state operations (locks, heartbeats, TTL keys)
export const redisClient = createRedisClient('main');
