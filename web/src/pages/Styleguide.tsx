import { Plus } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge, type Status } from '../components/StatusBadge';

const statuses: Status[] = ['up', 'down', 'degraded', 'maintenance', 'paused', 'pending'];

const sizes = [
  ['--text-3xl', '40px', 'Page hero'],
  ['--text-2xl', '28px', 'Page title'],
  ['--text-xl', '20px', 'Section title'],
  ['--text-lg', '16px', 'Card title, lead text'],
  ['--text-md', '14px', 'Body'],
  ['--text-sm', '13px', 'Tables, captions'],
  ['--text-xs', '12px', 'Labels, badges'],
] as const;

export function Styleguide() {
  return (
    <>
      <div className="stack" style={{ gap: 12 }}>
        <span className="eyebrow">Styleguide</span>
        <h1 style={{ fontSize: 'var(--text-3xl)' }}>The parts every screen is built from</h1>
        <p className="muted">All values come from the tokens in web/src/styles/tokens.css.</p>
      </div>

      <section className="section">
        <h2>Type scale</h2>
        <div className="card stack">
          {sizes.map(([token, px, use]) => (
            <div key={token} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: `var(${token})`, fontWeight: 600 }}>{use}</span>
              <code className="muted">
                {token} · {px}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Buttons</h2>
        <div className="card row">
          <button className="btn btn-primary">
            <Plus size={16} /> Add monitor
          </button>
          <button className="btn">Secondary</button>
          <button className="btn btn-ghost">Ghost</button>
          <button className="btn btn-danger">Delete</button>
          <button className="btn btn-primary" disabled>
            Disabled
          </button>
        </div>
      </section>

      <section className="section">
        <h2>Status badges</h2>
        <p className="muted">
          Colour, icon and word together, so status survives colour blindness.
        </p>
        <div className="card row">
          {statuses.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Form fields</h2>
        <div className="card grid-2">
          <div className="field">
            <label htmlFor="sg-url">URL</label>
            <input id="sg-url" className="input mono" defaultValue="https://harborpine.coffee" />
          </div>
          <div className="field">
            <label htmlFor="sg-int">Check interval</label>
            <input id="sg-int" className="input" defaultValue="60 seconds" />
            <span className="field-error">Choose a value between 30 and 300 seconds.</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Screen states</h2>
        <p className="muted">
          Every screen is designed in all four: loading, empty, error and filled.
        </p>
        <div className="grid-2">
          <div className="card stack">
            <h3>Loading</h3>
            <Skeleton rows={3} height={32} />
          </div>
          <div className="card stack">
            <h3>Error</h3>
            <ErrorState message="Could not load monitors." onRetry={() => undefined} />
          </div>
        </div>
        <EmptyState
          title="No clients yet"
          body="Clients group the sites you look after. Add one to give it a status page and a monthly report."
          action={<button className="btn btn-primary">Add a client</button>}
        />
      </section>
    </>
  );
}
