import { readLimited, safeFetch } from '@northstar/shared/fetch';
import { getDomain } from 'tldts';

// Domain expiry through RDAP, the structured successor to WHOIS. IANA publishes which
// RDAP server answers for each top-level domain; some registries (.tr among them) run
// none, and for those the agency types the date in by hand.

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const DAY = 86_400_000;

export type Bootstrap = Map<string, string>;

// "www.shop.harborpine.co.uk" -> "harborpine.co.uk"; null for IPs and bare suffixes.
export function registrableDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: false }) ?? null;
}

export function parseBootstrap(json: unknown): Bootstrap {
  const map: Bootstrap = new Map();
  const services = (json as { services?: [string[], string[]][] }).services ?? [];
  for (const [tlds, urls] of services) {
    const base = urls.find((u) => u.startsWith('https://')) ?? urls[0];
    if (!base) continue;
    for (const tld of tlds) map.set(tld.toLowerCase(), base.endsWith('/') ? base : `${base}/`);
  }
  return map;
}

export function rdapUrlFor(domain: string, bootstrap: Bootstrap): string | null {
  const labels = domain.toLowerCase().split('.');
  // Longest matching suffix first, in case a registry is listed for a second level.
  for (let i = 1; i < labels.length; i++) {
    const base = bootstrap.get(labels.slice(i).join('.'));
    if (base) return `${base}domain/${domain}`;
  }
  return null;
}

export function expiryFromRdap(json: unknown): Date | null {
  const events = (json as { events?: { eventAction?: string; eventDate?: string }[] }).events;
  const expiry = events?.find((e) => e.eventAction === 'expiration')?.eventDate;
  const date = expiry ? new Date(expiry) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

let cached: { at: number; bootstrap: Bootstrap } | undefined;

async function getJson(url: string, timeoutMs: number) {
  const { res } = await safeFetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    accept: 'application/rdap+json, application/json',
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${new URL(url).host} answered ${res.status}`);
  }
  const { text } = await readLimited(res, 1024 * 1024);
  return JSON.parse(text) as unknown;
}

async function bootstrap() {
  if (!cached || Date.now() - cached.at > DAY) {
    cached = { at: Date.now(), bootstrap: parseBootstrap(await getJson(BOOTSTRAP_URL, 15_000)) };
  }
  return cached.bootstrap;
}

export type DomainLookup = { expiresAt: Date | null; error: string | null };

export async function lookupDomainExpiry(domain: string): Promise<DomainLookup> {
  try {
    const url = rdapUrlFor(domain, await bootstrap());
    if (!url) {
      const tld = domain.split('.').pop();
      return {
        expiresAt: null,
        error: `The .${tld} registry has no RDAP service. Enter the expiry date by hand.`,
      };
    }
    const expiresAt = expiryFromRdap(await getJson(url, 15_000));
    return expiresAt
      ? { expiresAt, error: null }
      : { expiresAt: null, error: 'The registry did not publish an expiry date' };
  } catch (err) {
    return { expiresAt: null, error: err instanceof Error ? err.message : 'RDAP lookup failed' };
  }
}
