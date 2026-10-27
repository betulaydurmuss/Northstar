import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkHttp } from '../src/checks/http.js';
import { checkPing } from '../src/checks/ping.js';
import { runCheck } from '../src/checks/run.js';

// A local server stands in for a client's website. Local addresses are private, so these
// tests opt in with allowPrivate; the SSRF tests below check the default refuses them.
let server: Server;
let base: string;
let port: number;
let flaky = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') return res.end('fine');
    if (req.url === '/error') return res.writeHead(503).end();
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 2000);
    if (req.url === '/hop') return res.writeHead(302, { location: '/ok' }).end();
    if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end();
    if (req.url === '/flaky') return res.writeHead(flaky++ < 2 ? 500 : 200).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const allow = { timeoutMs: 1000, allowPrivate: true };

describe('checkHttp', () => {
  it('reports up with the status code and response time', async () => {
    const outcome = await checkHttp(`${base}/ok`, allow);
    expect(outcome).toMatchObject({ status: 'up', statusCode: 200, error: null });
    expect(outcome.responseMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a 5xx answer as down', async () => {
    expect(await checkHttp(`${base}/error`, allow)).toMatchObject({
      status: 'down',
      statusCode: 503,
      error: 'The server answered 503',
    });
  });

  it('gives up after the timeout', async () => {
    expect(await checkHttp(`${base}/slow`, allow)).toMatchObject({
      status: 'down',
      error: 'No response within 1 seconds',
    });
  });

  it('follows redirects', async () => {
    expect(await checkHttp(`${base}/hop`, allow)).toMatchObject({ status: 'up', statusCode: 200 });
  });

  it('stops following a redirect loop', async () => {
    expect((await checkHttp(`${base}/loop`, allow)).error).toMatch(/redirects/);
  });

  it('refuses private addresses unless explicitly allowed', async () => {
    const outcome = await checkHttp(`${base}/ok`, { timeoutMs: 1000 });
    expect(outcome.status).toBe('down');
    expect(outcome.error).toMatch(/private or reserved address/);
  });

  it('refuses names that resolve to private addresses', async () => {
    const outcome = await checkHttp(`http://localhost:${port}/ok`, { timeoutMs: 1000 });
    expect(outcome.error).toMatch(/private or reserved address/);
  });
});

describe('checkPing', () => {
  it('reports up when a TCP connection opens', async () => {
    expect(await checkPing(`127.0.0.1:${port}`, allow)).toMatchObject({ status: 'up' });
  });

  it('reports down when nothing listens', async () => {
    const outcome = await checkPing('127.0.0.1:1', allow);
    expect(outcome.status).toBe('down');
  });
});

describe('runCheck', () => {
  it('retries before calling a monitor down', async () => {
    flaky = 0;
    const outcome = await runCheck(
      { type: 'http', target: `${base}/flaky`, timeoutMs: 1000, retries: 2 },
      { allowPrivate: true, retryDelayMs: 10 },
    );
    expect(outcome.status).toBe('up');
    expect(flaky).toBe(3);
  });

  it('calls it down once every attempt has failed', async () => {
    const outcome = await runCheck(
      { type: 'http', target: `${base}/error`, timeoutMs: 1000, retries: 1 },
      { allowPrivate: true, retryDelayMs: 10 },
    );
    expect(outcome.status).toBe('down');
  });
});
