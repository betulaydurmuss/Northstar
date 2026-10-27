import { describe, expect, it } from 'vitest';
import { monitorInput, parsePingTarget } from '../src/monitor.js';

const valid = {
  name: 'Harbor & Pine Coffee',
  type: 'http',
  target: 'https://harborpine.coffee',
  intervalSec: 60,
  timeoutMs: 10000,
  retries: 2,
};

describe('monitorInput', () => {
  it('accepts a normal http monitor', () => {
    expect(monitorInput.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['an interval under 30 seconds', { intervalSec: 10 }],
    ['an interval over 300 seconds', { intervalSec: 600 }],
    ['a timeout longer than the interval', { intervalSec: 30, timeoutMs: 30000 }],
    ['a non-http scheme', { target: 'ftp://harborpine.coffee' }],
    ['credentials in the url', { target: 'https://admin:secret@harborpine.coffee' }],
    ['a bare host for an http monitor', { target: 'harborpine.coffee' }],
  ])('refuses %s', (_label, change) => {
    expect(monitorInput.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it('accepts a host and port for a ping monitor', () => {
    expect(
      monitorInput.safeParse({ ...valid, type: 'ping', target: 'mail.harborpine.coffee:587' })
        .success,
    ).toBe(true);
  });
});

describe('parsePingTarget', () => {
  it('defaults to port 443', () => {
    expect(parsePingTarget('harborpine.coffee')).toEqual({ host: 'harborpine.coffee', port: 443 });
  });

  it('reads an explicit port and bracketed IPv6', () => {
    expect(parsePingTarget('[2606:4700::1]:80')).toEqual({ host: '2606:4700::1', port: 80 });
  });

  it('refuses nonsense', () => {
    expect(parsePingTarget('not a host')).toBeNull();
    expect(parsePingTarget('example.com:99999')).toBeNull();
  });
});
