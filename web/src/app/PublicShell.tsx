import { Link, NavLink, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function PublicShell() {
  return (
    <>
      <header className="public-top">
        <div className="public-top-inner">
          <Link to="/" style={{ color: 'var(--text)' }}>
            <Logo />
          </Link>
          <nav className="nav">
            <NavLink to="/brand">Brand</NavLink>
            <NavLink to="/styleguide">Styleguide</NavLink>
            <NavLink to="/sign-in">Sign in</NavLink>
          </nav>
        </div>
      </header>
      <main className="public-content">
        <Outlet />
      </main>
    </>
  );
}
