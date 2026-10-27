import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

export function SignUp() {
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('Sign-up is not available yet.');
  }

  return (
    <AuthLayout
      title="Create your agency account"
      subtitle="Add your clients, then their sites. It takes a minute."
      foot={
        <>
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="name">Agency name</label>
          <input id="name" name="name" className="input" autoComplete="organization" required />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
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
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            At least 12 characters.
          </span>
        </div>
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit">
          Create account
        </button>
      </form>
    </AuthLayout>
  );
}
