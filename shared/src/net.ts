import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

// The SSRF guard. Monitors point at addresses typed in by customers; without this, a
// monitor for http://169.254.169.254/ or http://localhost:5432 would make our own servers
// probe the cloud metadata service or the database on the customer's behalf.

export class SsrfError extends Error {
  constructor(public address: string) {
    super(`Refusing to connect to a private or reserved address (${address})`);
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated), which embeds an IPv4 address
  ['64:ff9b::', 96], // NAT64, which can reach private IPv4 space
  ['64:ff9b:1::', 48], // local-use NAT64
  ['2002::', 16], // 6to4, which embeds an IPv4 address
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

// ::ffff:10.0.0.1 and ::ffff:a00:1 are IPv4 addresses wearing IPv6 clothes.
function unwrapMappedIpv4(ip: string): string | null {
  const match = /^::ffff:(.+)$/i.exec(ip);
  if (!match?.[1]) return null;
  if (isIP(match[1]) === 4) return match[1];
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(match[1]);
  if (!hex?.[1] || !hex[2]) return null;
  const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // not an address at all: refuse rather than guess
  if (family === 4) return blocked.check(ip, 'ipv4');
  const mapped = unwrapMappedIpv4(ip);
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(ip, 'ipv6');
}

export type GuardOptions = {
  // Only for local development, where the thing being monitored runs on this machine.
  allowPrivate?: boolean;
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

// A drop-in replacement for dns.lookup, for net.connect and HTTP agents. Because the check
// runs on the exact addresses the socket is about to use, a DNS answer that changes
// between "validate" and "connect" (DNS rebinding) cannot slip past it.
export function guardedLookup(options: GuardOptions = {}) {
  return (
    hostname: string,
    lookupOptions: { family?: number | string; all?: boolean },
    callback: LookupCallback,
  ) => {
    const family =
      lookupOptions.family === 'IPv6' || lookupOptions.family === 6
        ? 6
        : lookupOptions.family === 'IPv4' || lookupOptions.family === 4
          ? 4
          : 0;
    dnsLookup(hostname, { all: true, family }, (err, addresses) => {
      if (err) return callback(err, []);
      const bad = addresses.find((a) => isPrivateAddress(a.address));
      if (bad && !options.allowPrivate) return callback(new SsrfError(bad.address), []);
      if (lookupOptions.all) return callback(null, addresses);
      const first = addresses[0];
      if (!first) return callback(new Error(`No address for ${hostname}`), []);
      callback(null, first.address, first.family);
    });
  };
}

// Checks a host before anything is saved or fetched. Every address it resolves to must be
// public; one private address among several public ones is still refused.
export async function assertPublicHost(host: string, options: GuardOptions = {}) {
  if (options.allowPrivate) return;
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new SsrfError(bare);
    return;
  }
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(bare, { all: true }, (err, list) => (err ? reject(err) : resolve(list))),
  );
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  if (bad) throw new SsrfError(bad.address);
}
