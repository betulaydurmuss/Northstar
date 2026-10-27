import { SsrfError } from '@northstar/shared/net';

export type CheckOutcome = {
  status: 'up' | 'down';
  responseMs: number | null;
  statusCode: number | null;
  error: string | null;
};

export type CheckOptions = {
  timeoutMs: number;
  allowPrivate?: boolean;
};

export function down(error: string, extra: Partial<CheckOutcome> = {}): CheckOutcome {
  return { status: 'down', responseMs: null, statusCode: null, error, ...extra };
}

// Turns low-level network errors into sentences that make sense in an alert email.
export function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof SsrfError) return err.message;
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return `No response within ${timeoutMs / 1000} seconds`;
  }
  const cause = e?.cause instanceof SsrfError ? e.cause : null;
  if (cause) return cause.message;
  const code = e?.cause?.code ?? e?.code;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The domain name could not be resolved';
    case 'ECONNREFUSED':
      return 'The server refused the connection';
    case 'ECONNRESET':
      return 'The connection was reset';
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `No response within ${timeoutMs / 1000} seconds`;
    case 'CERT_HAS_EXPIRED':
      return 'The TLS certificate has expired';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'The TLS certificate does not match the domain';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'The TLS certificate is self-signed';
  }
  return e?.cause?.message ?? (err instanceof Error ? err.message : 'The check failed');
}
