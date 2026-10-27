import { guardedLookup, isPrivateAddress, SsrfError } from '@northstar/shared/net';
import { isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import { describeError, down, type CheckOptions, type CheckOutcome } from './outcome.js';

const MAX_REDIRECTS = 5;
const USER_AGENT = 'NorthstarBot/1.0 (uptime monitoring)';

// One connection pool per policy. The guarded lookup checks every address a socket is
// about to connect to, including the targets of redirects.
const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean) {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({ connect: { lookup: guardedLookup({ allowPrivate }) } });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

// DNS lookup is skipped for IP literals, so those are checked here instead.
function assertLiteralIsPublic(url: URL, allowPrivate: boolean) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) throw new SsrfError(host);
}

// Up means a 2xx or 3xx answer within the timeout, after following up to five redirects.
export async function checkHttp(target: string, options: CheckOptions): Promise<CheckOutcome> {
  const allowPrivate = options.allowPrivate ?? false;
  const signal = AbortSignal.timeout(options.timeoutMs);
  const started = performance.now();

  try {
    let url = new URL(target);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      assertLiteralIsPublic(url, allowPrivate);
      const res = await fetch(url, {
        redirect: 'manual',
        signal,
        dispatcher: agentFor(allowPrivate),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      });
      // Only the status matters; drop the body so the socket can be reused.
      await res.body?.cancel();

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return down(`Redirected to an unsupported address (${url.protocol})`);
        }
        continue;
      }

      const responseMs = Math.round(performance.now() - started);
      if (res.status >= 200 && res.status < 400) {
        return { status: 'up', responseMs, statusCode: res.status, error: null };
      }
      return down(`The server answered ${res.status}`, { responseMs, statusCode: res.status });
    }
    return down(`More than ${MAX_REDIRECTS} redirects`);
  } catch (err) {
    return down(describeError(err, options.timeoutMs));
  }
}
