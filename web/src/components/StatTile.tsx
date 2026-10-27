import type { ReactNode } from 'react';

export function StatTile({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      {loading ? (
        <span className="skeleton" style={{ height: 28, width: '60%' }} />
      ) : (
        <span className="tile-value">{value}</span>
      )}
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}
