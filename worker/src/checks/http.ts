import { readLimited, RedirectError, safeFetch } from '@northstar/shared/fetch';
import { describeError, down, type CheckOptions, type CheckOutcome } from './outcome.js';

// Up means a 2xx or 3xx answer within the timeout, after following up to five redirects.
export async function checkHttp(target: string, options: CheckOptions): Promise<CheckOutcome> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const started = performance.now();
  try {
    const { res } = await safeFetch(target, { signal, allowPrivate: options.allowPrivate });
    // Only the status matters; drop the body so the socket can be reused.
    await res.body?.cancel();
    const responseMs = Math.round(performance.now() - started);
    if (res.status >= 200 && res.status < 400) {
      return { status: 'up', responseMs, statusCode: res.status, error: null };
    }
    return down(`The server answered ${res.status}`, { responseMs, statusCode: res.status });
  } catch (err) {
    if (err instanceof RedirectError) return down(err.message);
    return down(describeError(err, options.timeoutMs));
  }
}

// Pages larger than this are searched only in their first 2 MB.
export const KEYWORD_MAX_BYTES = 2 * 1024 * 1024;

export type KeywordRule = { keyword: string; mode: 'present' | 'absent'; caseSensitive: boolean };

export function keywordProblem(body: string, rule: KeywordRule): string | null {
  const haystack = rule.caseSensitive ? body : body.toLowerCase();
  const needle = rule.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
  const found = haystack.includes(needle);
  if (rule.mode === 'present' && !found) return `"${rule.keyword}" was not found on the page`;
  if (rule.mode === 'absent' && found) return `"${rule.keyword}" appeared on the page`;
  return null;
}

// A page can answer 200 and still be broken: a CMS error, a parked domain, a maintenance
// notice. Keyword monitors read the page and look for (or against) a piece of text.
export async function checkKeyword(
  target: string,
  rule: KeywordRule,
  options: CheckOptions,
): Promise<CheckOutcome> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const started = performance.now();
  try {
    const { res } = await safeFetch(target, { signal, allowPrivate: options.allowPrivate });
    if (res.status < 200 || res.status >= 400) {
      await res.body?.cancel();
      const responseMs = Math.round(performance.now() - started);
      return down(`The server answered ${res.status}`, { responseMs, statusCode: res.status });
    }
    const { text } = await readLimited(res, KEYWORD_MAX_BYTES);
    const responseMs = Math.round(performance.now() - started);
    const problem = keywordProblem(text, rule);
    if (problem) return down(problem, { responseMs, statusCode: res.status });
    return { status: 'up', responseMs, statusCode: res.status, error: null };
  } catch (err) {
    if (err instanceof RedirectError) return down(err.message);
    return down(describeError(err, options.timeoutMs));
  }
}
