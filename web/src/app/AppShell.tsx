import { Activity, LayoutGrid, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { useMe } from '../lib/auth';

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
            <NavLink to="/incidents">
              <Activity size={16} /> Incidents
            </NavLink>
            <NavLink to="/settings">
              <Settings size={16} /> Settings
            </NavLink>
          </nav>
        </div>
      </aside>
      <div className="main">
        <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
          <span className="muted">{me?.name}</span>
          <span className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
            {me?.email}
          </span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
