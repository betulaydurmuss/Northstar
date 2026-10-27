// The heart of alerting, kept free of the database so it can be tested exhaustively.
//
// Given what a monitor was and what the latest check found, decide what it is now and
// whether an incident opens, closes, or nothing happens. A monitor that stays down does
// not alert again; only a change of state does. During planned maintenance nothing
// alerts at all.

export type MonitorState = 'pending' | 'up' | 'down' | 'paused' | 'maintenance';
export type CheckStatus = 'up' | 'down';

export type Transition = {
  next: CheckStatus | 'maintenance';
  openIncident: boolean;
  closeIncident: boolean;
  notify: 'down' | 'up' | null;
};

export function transition(
  current: MonitorState,
  result: CheckStatus,
  inMaintenance = false,
): Transition {
  if (inMaintenance) {
    // An outage that was already open ends quietly when planned work begins; whatever
    // happens during the window is expected and not reported.
    return {
      next: 'maintenance',
      openIncident: false,
      closeIncident: current === 'down',
      notify: null,
    };
  }
  // After a window the monitor starts fresh, as if it had never been checked.
  const from = current === 'maintenance' ? 'pending' : current;

  if (result === 'down' && from !== 'down') {
    return { next: 'down', openIncident: true, closeIncident: false, notify: 'down' };
  }
  if (result === 'up' && from === 'down') {
    return { next: 'up', openIncident: false, closeIncident: true, notify: 'up' };
  }
  // pending -> up, up -> up, down -> down: record the check, say nothing.
  return { next: result, openIncident: false, closeIncident: false, notify: null };
}
