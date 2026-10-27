import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://northstar:northstar@localhost:5432/northstar'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('Northstar <alerts@northstar.local>'),

  // How many checks run at the same time in one worker process.
  CHECK_CONCURRENCY: z.coerce.number().int().positive().default(20),
  // Development only: lets monitors point at servers on this machine or network.
  ALLOW_PRIVATE_TARGETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const config = schema.parse(process.env);
