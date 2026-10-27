import { createRedis } from './redis.js';

const redis = createRedis();

redis.on('ready', () => {
  console.log('worker connected to redis');
});

async function shutdown() {
  await redis.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
