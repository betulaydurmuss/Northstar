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

  // Signs access tokens. At least 32 random characters.
  JWT_SECRET: z.string().min(32),
  // 32 bytes, base64. Encrypts TOTP secrets and notification settings at rest.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes in base64'),
  // How many proxies sit in front of the api, so req.ip is the visitor and not the proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Development only: lets monitors point at servers on this machine or network.
  ALLOW_PRIVATE_TARGETS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('Northstar <alerts@northstar.local>'),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
