import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

export function SignIn() {
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('Sign-in is not available yet.');
  }

  return (
    <AuthLayout
      title="Sign in to Northstar"
      subtitle="Every client site, watched from one place."
      foot={
        <>
          New here? <Link to="/sign-up">Create an account</Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" style={{ fontSize: 'var(--text-sm)' }}>
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit">
          Sign in
        </button>
      </form>
    </AuthLayout>
  );
}
