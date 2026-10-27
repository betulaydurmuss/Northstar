import { isIP } from 'node:net';
import { Agent, fetch, type Response } from 'undici';
import { guardedLookup, isPrivateAddress, SsrfError } from './net.js';

// Every request Northstar makes to an address a customer typed in goes through here:
// uptime checks, keyword checks, sitemaps. Redirects are followed by hand so each hop is
// checked, and the connection pool resolves names through the SSRF guard.

export const MAX_REDIRECTS = 5;
const USER_AGENT = 'NorthstarBot/1.0 (uptime monitoring)';

export class RedirectError extends Error {}

// One connection pool per policy.
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

export type SafeFetchOptions = {
  signal: AbortSignal;
  allowPrivate?: boolean;
  accept?: string;
};

// Returns the final response after redirects. The caller owns its body: read it or
// cancel it.
export async function safeFetch(target: string | URL, options: SafeFetchOptions) {
  const allowPrivate = options.allowPrivate ?? false;
  let url = new URL(target);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertLiteralIsPublic(url, allowPrivate);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: options.signal,
      dispatcher: agentFor(allowPrivate),
      headers: { 'user-agent': USER_AGENT, accept: options.accept ?? 'text/html,*/*' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new RedirectError(`Redirected to an unsupported address (${url.protocol})`);
      }
      continue;
    }
    return { res, url };
  }
  throw new RedirectError(`More than ${MAX_REDIRECTS} redirects`);
}

// Reads at most maxBytes of a body, so a huge or endless page cannot exhaust memory.
export async function readLimited(res: Response, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (res.body) {
    for await (const chunk of res.body) {
      const piece = chunk as Uint8Array;
      if (size + piece.byteLength > maxBytes) {
        chunks.push(piece.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(piece);
      size += piece.byteLength;
    }
  }
  if (truncated) await res.body?.cancel().catch(() => undefined);
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}
