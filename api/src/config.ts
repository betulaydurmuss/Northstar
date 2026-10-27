import { z } from 'zod';

// Read once at startup so a missing or malformed variable fails loudly before
// the server accepts a single request.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://northstar:northstar@localhost:5432/northstar'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
