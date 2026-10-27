import { checkHttp } from './http.js';
import type { CheckOptions, CheckOutcome } from './outcome.js';
import { checkPing } from './ping.js';

type MonitorToCheck = { type: 'http' | 'ping'; target: string; timeoutMs: number; retries: number };

const checks = { http: checkHttp, ping: checkPing };

// A single failed request is often a blip. The monitor is only reported down after the
// first attempt and every retry have failed; one success is enough to call it up.
export async function runCheck(
  monitor: MonitorToCheck,
  options: Omit<CheckOptions, 'timeoutMs'> & { retryDelayMs?: number } = {},
): Promise<CheckOutcome> {
  const check = checks[monitor.type];
  const delay = options.retryDelayMs ?? 2000;
  let outcome: CheckOutcome | undefined;

  for (let attempt = 0; attempt <= monitor.retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delay));
    outcome = await check(monitor.target, { ...options, timeoutMs: monitor.timeoutMs });
    if (outcome.status === 'up') return outcome;
  }
  return outcome!;
}
