// A small fetch wrapper. The access token lives only in memory; the refresh token is an
// httpOnly cookie the browser sends to /api/auth/refresh on its own. When a request comes
// back 401 we refresh once and retry, so a 15-minute access token never logs anyone out.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

// The api refuses state-changing requests without this header (its CSRF defence).
const CSRF = { 'X-Requested-With': 'northstar' };

// Endpoints used while signed out: a 401 from these is an answer, not an expired token.
const SIGNED_OUT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/2fa/verify',
  '/auth/forgot-password',
  '/auth/reset-password',
];

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function refresh(): Promise<boolean> {
  // Several requests can expire at the same moment; they all wait on one refresh.
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: CSRF,
  })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

export async function api<T>(path: string, options: Options = {}, retried = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Requested-With', CSRF['X-Requested-With']);
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });

  if (res.status === 401 && !retried && !SIGNED_OUT_PATHS.includes(path)) {
    if (await refresh()) return api<T>(path, options, true);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new ApiError(res.status, body.error ?? res.statusText, body.details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { refresh as refreshSession };
