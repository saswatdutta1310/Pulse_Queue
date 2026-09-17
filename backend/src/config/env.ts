import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  DATABASE_URL: process.env.DATABASE_URL || '',
  HEARTBEAT_INTERVAL_MS: 2000,
  REAPER_INTERVAL_MS: 2500,
  MISSED_HEARTBEAT_THRESHOLD_MS: 5500, // ~3 missed heartbeats
  DEFAULT_WORKERS_COUNT: 3
};
