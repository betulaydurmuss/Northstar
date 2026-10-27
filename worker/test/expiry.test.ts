import { describe, expect, it } from 'vitest';
import {
  expiryFromRdap,
  parseBootstrap,
  rdapUrlFor,
  registrableDomain,
} from '../src/checks/domain.js';
import { keywordProblem } from '../src/checks/http.js';
import { daysLeft, noticePlan } from '../src/expiry.js';

describe('noticePlan', () => {
  it('sends nothing while more than 30 days remain', () => {
    expect(noticePlan(45, [])).toEqual({ send: null, record: [] });
  });

  it('sends the 30-day warning once', () => {
    expect(noticePlan(30, [])).toEqual({ send: 30, record: [30] });
    expect(noticePlan(29, [30])).toEqual({ send: null, record: [] });
  });

  it('moves to the next threshold as the date approaches', () => {
    expect(noticePlan(14, [30])).toEqual({ send: 15, record: [15] });
    expect(noticePlan(1, [30, 15, 7])).toEqual({ send: 1, record: [1] });
  });

  it('sends only the most urgent warning when several are crossed at once', () => {
    expect(noticePlan(5, [])).toEqual({ send: 7, record: [30, 15, 7] });
  });

  it('warns about something that has already expired', () => {
    expect(noticePlan(-2, []).send).toBe(1);
  });
});

describe('daysLeft', () => {
  it('rounds part of a day up', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(daysLeft(new Date('2026-10-28T06:00:00Z'), now)).toBe(1);
    expect(daysLeft(new Date('2026-11-26T12:00:00Z'), now)).toBe(30);
  });
});

describe('RDAP', () => {
  const bootstrap = parseBootstrap({
    services: [
      [['com', 'net'], ['https://rdap.verisign.com/com/v1/']],
      [['uk'], ['http://rdap.nominet.uk/uk', 'https://rdap.nominet.uk/uk']],
    ],
  });

  it('finds the registrable domain behind a host name', () => {
    expect(registrableDomain('www.shop.harborpine.co.uk')).toBe('harborpine.co.uk');
    expect(registrableDomain('kettle.com.tr')).toBe('kettle.com.tr');
    expect(registrableDomain('93.184.215.14')).toBeNull();
  });

  it('picks the https server for a TLD', () => {
    expect(rdapUrlFor('harborpine.co.uk', bootstrap)).toBe(
      'https://rdap.nominet.uk/uk/domain/harborpine.co.uk',
    );
    expect(rdapUrlFor('example.com', bootstrap)).toBe(
      'https://rdap.verisign.com/com/v1/domain/example.com',
    );
  });

  it('has nothing for a TLD without RDAP', () => {
    expect(rdapUrlFor('kettle.com.tr', bootstrap)).toBeNull();
  });

  it('reads the expiration event', () => {
    const json = {
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
      ],
    };
    expect(expiryFromRdap(json)?.toISOString()).toBe('2027-08-13T04:00:00.000Z');
    expect(expiryFromRdap({ events: [] })).toBeNull();
  });
});

describe('keywordProblem', () => {
  const page = '<h1>Fresh bread every morning</h1><p>Open 7am to 3pm</p>';

  it('passes when required text is present, ignoring case by default', () => {
    expect(
      keywordProblem(page, { keyword: 'fresh BREAD', mode: 'present', caseSensitive: false }),
    ).toBeNull();
  });

  it('fails when required text is missing', () => {
    expect(
      keywordProblem(page, { keyword: 'Order online', mode: 'present', caseSensitive: false }),
    ).toBe('"Order online" was not found on the page');
  });

  it('respects case sensitivity', () => {
    expect(
      keywordProblem(page, { keyword: 'fresh', mode: 'present', caseSensitive: true }),
    ).not.toBeNull();
  });

  it('fails when forbidden text appears', () => {
    expect(
      keywordProblem('<p>Error establishing a database connection</p>', {
        keyword: 'database connection',
        mode: 'absent',
        caseSensitive: false,
      }),
    ).toBe('"database connection" appeared on the page');
  });
});
