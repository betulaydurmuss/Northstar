import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateAddress, SsrfError } from '../src/net.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    'not-an-ip',
  ])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.215.14', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertPublicHost', () => {
  it('refuses a private IP literal', async () => {
    await expect(assertPublicHost('10.0.0.5')).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicHost('[::1]')).rejects.toBeInstanceOf(SsrfError);
  });

  it('refuses a name that resolves to loopback', async () => {
    await expect(assertPublicHost('localhost')).rejects.toBeInstanceOf(SsrfError);
  });

  it('lets everything through when private targets are explicitly allowed', async () => {
    await expect(assertPublicHost('localhost', { allowPrivate: true })).resolves.toBeUndefined();
  });
});
