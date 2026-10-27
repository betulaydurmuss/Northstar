import { describe, expect, it } from 'vitest';
import { transition, type MonitorState } from '../src/incidents.js';

describe('transition', () => {
  it('opens an incident and alerts when an up monitor goes down', () => {
    expect(transition('up', 'down')).toEqual({
      next: 'down',
      openIncident: true,
      closeIncident: false,
      notify: 'down',
    });
  });

  it('closes the incident and alerts when a down monitor comes back', () => {
    expect(transition('down', 'up')).toEqual({
      next: 'up',
      openIncident: false,
      closeIncident: true,
      notify: 'up',
    });
  });

  it('stays quiet while a monitor stays down', () => {
    expect(transition('down', 'down')).toEqual({
      next: 'down',
      openIncident: false,
      closeIncident: false,
      notify: null,
    });
  });

  it('stays quiet while a monitor stays up', () => {
    expect(transition('up', 'up').notify).toBeNull();
  });

  it('treats the first successful check as the normal state, not a recovery', () => {
    expect(transition('pending', 'up')).toMatchObject({
      next: 'up',
      closeIncident: false,
      notify: null,
    });
  });

  it('alerts when the very first check fails', () => {
    expect(transition('pending', 'down')).toMatchObject({ openIncident: true, notify: 'down' });
  });

  // Walk a realistic day: two outages, each producing exactly one alert in each direction.
  it('produces one alert per change across a sequence of checks', () => {
    const results = ['up', 'up', 'down', 'down', 'down', 'up', 'up', 'down', 'up'] as const;
    let state: MonitorState = 'pending';
    const alerts: string[] = [];
    for (const r of results) {
      const t = transition(state, r);
      if (t.notify) alerts.push(t.notify);
      state = t.next;
    }
    expect(alerts).toEqual(['down', 'up', 'down', 'up']);
  });
});
