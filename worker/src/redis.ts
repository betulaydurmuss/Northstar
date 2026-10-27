import { Redis } from 'ioredis';
import { config } from './config.js';

// BullMQ needs maxRetriesPerRequest disabled so blocking commands wait instead of failing.
export function createRedis() {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
}
