import { checkHttp, checkKeyword } from './http.js';
import type { CheckOptions, CheckOutcome } from './outcome.js';
import { checkPing } from './ping.js';

type MonitorToCheck = {
  type: 'http' | 'ping' | 'keyword';
  target: string;
  timeoutMs: number;
  retries: number;
  keyword?: string | null;
  keywordMode?: 'present' | 'absent' | null;
  keywordCaseSensitive?: boolean;
};

function checkOnce(monitor: MonitorToCheck, options: CheckOptions) {
  switch (monitor.type) {
    case 'http':
      return checkHttp(monitor.target, options);
    case 'ping':
      return checkPing(monitor.target, options);
    case 'keyword':
      return checkKeyword(
        monitor.target,
        {
          keyword: monitor.keyword ?? '',
          mode: monitor.keywordMode ?? 'present',
          caseSensitive: monitor.keywordCaseSensitive ?? false,
        },
        options,
      );
  }
}

// A single failed request is often a blip. The monitor is only reported down after the
// first attempt and every retry have failed; one success is enough to call it up.
export async function runCheck(
  monitor: MonitorToCheck,
  options: Omit<CheckOptions, 'timeoutMs'> & { retryDelayMs?: number } = {},
): Promise<CheckOutcome> {
  const delay = options.retryDelayMs ?? 2000;
  let outcome: CheckOutcome | undefined;

  for (let attempt = 0; attempt <= monitor.retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, delay));
    outcome = await checkOnce(monitor, { ...options, timeoutMs: monitor.timeoutMs });
    if (outcome.status === 'up') return outcome;
  }
  return outcome!;
}
