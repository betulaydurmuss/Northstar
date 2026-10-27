import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://northstar:northstar@localhost:5432/northstar'),
});

export const config = schema.parse(process.env);
