import { Check, Circle, Pause, Wrench, X, TriangleAlert } from 'lucide-react';

export type Status = 'up' | 'down' | 'degraded' | 'maintenance' | 'paused' | 'pending';

// Status is never told by colour alone: every badge carries an icon and a word.
const LABELS: Record<Status, { text: string; Icon: typeof Check }> = {
  up: { text: 'Operational', Icon: Check },
  down: { text: 'Down', Icon: X },
  degraded: { text: 'Degraded', Icon: TriangleAlert },
  maintenance: { text: 'Maintenance', Icon: Wrench },
  paused: { text: 'Paused', Icon: Pause },
  pending: { text: 'Pending', Icon: Circle },
};

// `label` replaces the word when the state means something more specific in context,
// such as "Resolved" for an incident; the colour and icon stay those of the state.
export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const { text, Icon } = LABELS[status];
  return (
    <span className={`badge badge-${status}`}>
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {label ?? text}
    </span>
  );
}
