import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword() {
  const [sent, setSent] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email you a link that works for one hour."
      foot={<Link to="/sign-in">Back to sign in</Link>}
    >
      {sent ? (
        <p>If an account exists for that address, a reset link is on its way.</p>
      ) : (
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
          <button className="btn btn-primary btn-block" type="submit">
            Send reset link
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
