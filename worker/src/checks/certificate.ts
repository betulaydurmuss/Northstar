import { guardedLookup, isPrivateAddress, SsrfError } from '@northstar/shared/net';
import { isIP } from 'node:net';
import { connect, type PeerCertificate } from 'node:tls';

export type CertificateInfo = {
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  authorized: boolean;
  error: string | null;
};

// Certificate fields can repeat (several OUs, say); the first value is the one people know.
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

function name(entity: PeerCertificate['issuer'] | undefined) {
  if (!entity) return null;
  return first(entity.O) ?? first(entity.CN);
}

// Opens a TLS connection only to read the certificate. Verification is reported, not
// enforced, so an expired or self-signed certificate is still read and its dates stored.
export function readCertificate(
  url: URL,
  options: { timeoutMs: number; allowPrivate?: boolean },
): Promise<CertificateInfo> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const allowPrivate = options.allowPrivate ?? false;
  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
    return Promise.reject(new SsrfError(host));
  }

  return new Promise((resolve, reject) => {
    const socket = connect({
      host,
      port: Number(url.port) || 443,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      lookup: guardedLookup({ allowPrivate }),
    });
    socket.setTimeout(options.timeoutMs);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const info: CertificateInfo = {
        issuer: name(cert.issuer),
        subject: first(cert.subject?.CN),
        validFrom: cert.valid_from ? new Date(cert.valid_from) : null,
        validTo: cert.valid_to ? new Date(cert.valid_to) : null,
        authorized: socket.authorized,
        error: socket.authorizationError ? String(socket.authorizationError) : null,
      };
      socket.destroy();
      resolve(info);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`No TLS handshake within ${options.timeoutMs / 1000} seconds`));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}
