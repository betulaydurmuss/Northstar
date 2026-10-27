import type { ReactNode } from 'react';

// The four states every screen must cover. "Filled" is the screen itself.

export function Skeleton({ rows = 3, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <h3>{title}</h3>
      <p className="muted" style={{ margin: '8px auto 20px', maxWidth: 420 }}>
        {body}
      </p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="notice notice-error row"
      role="alert"
      style={{ justifyContent: 'space-between' }}
    >
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
