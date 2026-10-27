import { parsePingTarget } from '@northstar/shared/monitor';
import { guardedLookup, isPrivateAddress, SsrfError } from '@northstar/shared/net';
import { connect, isIP } from 'node:net';
import { describeError, down, type CheckOptions, type CheckOutcome } from './outcome.js';

// "Ping" by opening a TCP connection. ICMP needs raw sockets and root in most containers;
// a completed handshake is a stronger signal anyway, because it proves a service listens.
export async function checkPing(target: string, options: CheckOptions): Promise<CheckOutcome> {
  const parsed = parsePingTarget(target);
  if (!parsed) return down('The target is not a valid host');
  const { host, port } = parsed;
  const allowPrivate = options.allowPrivate ?? false;

  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
    return down(new SsrfError(host).message);
  }

  const started = performance.now();
  return new Promise((resolve) => {
    const socket = connect({ host, port, lookup: guardedLookup({ allowPrivate }) });
    socket.setTimeout(options.timeoutMs);

    socket.once('connect', () => {
      const responseMs = Math.round(performance.now() - started);
      socket.destroy();
      resolve({ status: 'up', responseMs, statusCode: null, error: null });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(down(`No response within ${options.timeoutMs / 1000} seconds`));
    });
    socket.once('error', (err) => {
      socket.destroy();
      resolve(down(describeError(err, options.timeoutMs)));
    });
  });
}
