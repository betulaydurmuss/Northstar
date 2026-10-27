import { LayoutGrid, LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { SECURITY_PATH, useMe, useSignOut } from '../lib/auth';

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

export function AppShell() {
  const scrolled = useScrolled();
  const { data: me } = useMe();
  const signOut = useSignOut();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
        </div>
        <div>
          <div className="nav-label">Monitoring</div>
          <nav className="nav">
            <NavLink to="/" end>
              <LayoutGrid size={16} /> Overview
            </NavLink>
          </nav>
        </div>
        <div>
          <div className="nav-label">Account</div>
          <nav className="nav">
            <NavLink to={SECURITY_PATH}>
              <ShieldCheck size={16} /> Security
            </NavLink>
          </nav>
        </div>
      </aside>
      <div className="main">
        <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
          <span className="muted">{me?.name}</span>
          <div className="row" style={{ gap: 4 }}>
            <span className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
              {me?.email}
            </span>
            <button className="btn btn-ghost" onClick={signOut} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
