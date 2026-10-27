import { z } from 'zod';

// The rules for a monitor, shared by the api (which enforces them) and the web form
// (which explains them before the request is sent). Browser-safe: no Node imports.

export const MONITOR_TYPES = ['http', 'ping'] as const;
export type MonitorType = (typeof MONITOR_TYPES)[number];

export const LIMITS = {
  intervalSec: { min: 30, max: 300, default: 60 },
  timeoutMs: { min: 1000, max: 30000, default: 10000 },
  retries: { min: 0, max: 5, default: 2 },
} as const;

// A ping monitor opens a TCP connection; without a port we try HTTPS.
export const DEFAULT_PING_PORT = 443;

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

export function parsePingTarget(target: string): { host: string; port: number } | null {
  const match = /^(\[[0-9a-f:]+\]|[^:]+)(?::(\d{1,5}))?$/i.exec(target.trim());
  if (!match?.[1]) return null;
  const host = match[1].replace(/^\[|\]$/g, '');
  const port = match[2] ? Number(match[2]) : DEFAULT_PING_PORT;
  if (port < 1 || port > 65535) return null;
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.includes(':');
  if (!isIpv4 && !isIpv6 && !HOSTNAME.test(host)) return null;
  return { host, port };
}

export function parseHttpTarget(target: string): URL | null {
  try {
    const url = new URL(target.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Credentials in a URL end up in logs and emails; ask for a public endpoint instead.
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

const base = z.object({
  name: z.string().trim().min(1, 'Give the monitor a name').max(120),
  type: z.enum(MONITOR_TYPES),
  target: z.string().trim().min(1, 'Enter an address to check').max(2048),
  intervalSec: z.coerce
    .number()
    .int()
    .min(LIMITS.intervalSec.min, `Check at most every ${LIMITS.intervalSec.min} seconds`)
    .max(LIMITS.intervalSec.max, `Check at least every ${LIMITS.intervalSec.max} seconds`),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(LIMITS.timeoutMs.min, 'Allow at least one second')
    .max(LIMITS.timeoutMs.max, 'Allow at most 30 seconds'),
  retries: z.coerce.number().int().min(LIMITS.retries.min).max(LIMITS.retries.max),
});

function refineMonitor(m: z.infer<typeof base>, ctx: z.RefinementCtx) {
  if (m.type === 'http' && !parseHttpTarget(m.target)) {
    ctx.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Enter a full http:// or https:// address without a username or password',
    });
  }
  if (m.type === 'ping' && !parsePingTarget(m.target)) {
    ctx.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Enter a host name, optionally with a port, such as example.com:443',
    });
  }
  if (m.timeoutMs >= m.intervalSec * 1000) {
    ctx.addIssue({
      code: 'custom',
      path: ['timeoutMs'],
      message: 'The timeout must be shorter than the check interval',
    });
  }
}

export const monitorInput = base.superRefine(refineMonitor);
export type MonitorInput = z.infer<typeof monitorInput>;

// Partial updates are checked against the stored monitor merged with the change.
export const monitorPatch = base.partial();
