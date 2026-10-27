// The heart of alerting, kept free of the database so it can be tested exhaustively.
//
// Given what a monitor was and what the latest check found, decide what it is now and
// whether an incident opens, closes, or nothing happens. A monitor that stays down does
// not alert again; only a change of state does.

export type MonitorState = 'pending' | 'up' | 'down' | 'paused';
export type CheckStatus = 'up' | 'down';

export type Transition = {
  next: CheckStatus;
  openIncident: boolean;
  closeIncident: boolean;
  notify: 'down' | 'up' | null;
};

export function transition(current: MonitorState, result: CheckStatus): Transition {
  if (result === 'down' && current !== 'down') {
    return { next: 'down', openIncident: true, closeIncident: false, notify: 'down' };
  }
  if (result === 'up' && current === 'down') {
    return { next: 'up', openIncident: false, closeIncident: true, notify: 'up' };
  }
  // pending -> up, up -> up, down -> down: record the check, say nothing.
  return { next: result, openIncident: false, closeIncident: false, notify: null };
}
