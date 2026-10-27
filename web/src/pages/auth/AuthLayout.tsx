import type { ReactNode } from 'react';
import { Mark } from '../../components/Logo';

export function AuthLayout({
  title,
  subtitle,
  children,
  foot,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div style={{ display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center' }}>
          <Mark size={40} />
          <h1 style={{ fontSize: 'var(--text-xl)' }}>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="card">{children}</div>
        {foot && <div className="auth-foot">{foot}</div>}
      </div>
    </div>
  );
}
