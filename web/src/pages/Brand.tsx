import type { ReactNode } from 'react';
import iconUrl from '../brand/northstar-icon.svg';
import logoDarkUrl from '../brand/northstar-logo-dark.svg';
import logoLightUrl from '../brand/northstar-logo-light.svg';
import markDarkUrl from '../brand/northstar-mark-dark.svg';
import markLightUrl from '../brand/northstar-mark-light.svg';

const palette = [
  { token: '--accent', hex: '#818CF8', use: 'The one accent: actions, focus, links, the mark' },
  { token: '--bg', hex: '#0B0C14', use: 'Page background' },
  { token: '--surface', hex: '#11131D', use: 'Cards and panels' },
  { token: '--raised', hex: '#181B28', use: 'Hover, inputs, nested surfaces' },
  { token: '--line', hex: '#252A3B', use: 'Hairlines between surfaces' },
  { token: '--text', hex: '#E7E9F3', use: 'Body text' },
  { token: '--muted', hex: '#8A90A8', use: 'Secondary text, paused state' },
];

const statusColours = [
  { token: '--good', hex: '#34D399', use: 'Operational' },
  { token: '--bad', hex: '#F87171', use: 'Down' },
  { token: '--warn', hex: '#FBBF24', use: 'Degraded, expiring soon' },
  { token: '--info', hex: '#38BDF8', use: 'Maintenance' },
];

function Swatch({ token, hex, use }: { token: string; hex: string; use: string }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{ height: 64, background: `var(${token})`, borderBottom: '1px solid var(--line)' }}
      />
      <div style={{ padding: '12px 14px', display: 'grid', gap: 2 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <code>{token}</code>
          <code className="muted">{hex}</code>
        </div>
        <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {use}
        </span>
      </div>
    </div>
  );
}

function Tile({ bg, children, caption }: { bg: string; children: ReactNode; caption: string }) {
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 8 }}>
      <div
        style={{
          background: bg,
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-lg)',
          minHeight: 140,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        {children}
      </div>
      <figcaption className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function Brand() {
  return (
    <>
      <div className="stack" style={{ gap: 12, maxWidth: 680 }}>
        <span className="eyebrow">Brand</span>
        <h1 style={{ fontSize: 'var(--text-3xl)' }}>Northstar</h1>
        <p style={{ fontSize: 'var(--text-lg)' }}>
          Uptime monitoring for agencies that answer to many clients.
        </p>
        <p className="muted">
          The north star is the one point in the sky that stays put while everything else moves.
          That is the promise to an agency: whatever happens across forty client sites, there is one
          steady place that knows. The mark is four rays with the northern one drawn longer, so it
          reads as a direction and not a sparkle.
        </p>
      </div>

      <section className="section">
        <h2>Logo</h2>
        <div className="grid-2">
          <Tile bg="#0B0C14" caption="Primary logo on dark. The default everywhere in the product.">
            <img src={logoDarkUrl} alt="Northstar logo on a dark background" height={48} />
          </Tile>
          <Tile bg="#FFFFFF" caption="Primary logo on light. Used in emails and the PDF report.">
            <img src={logoLightUrl} alt="Northstar logo on a light background" height={48} />
          </Tile>
          <Tile bg="#0B0C14" caption="Mark only, on dark.">
            <img src={markDarkUrl} alt="Northstar mark on dark" height={64} />
          </Tile>
          <Tile bg="#FFFFFF" caption="Mark only, on light.">
            <img src={markLightUrl} alt="Northstar mark on light" height={64} />
          </Tile>
        </div>
      </section>

      <section className="section">
        <h2>App icon and favicon</h2>
        <p className="muted">
          The same mark on an indigo tile, tested at every size browsers and phones ask for.
        </p>
        <div className="card row" style={{ gap: 32, alignItems: 'flex-end' }}>
          {[16, 32, 64, 128].map((size) => (
            <div key={size} style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
              <img src={iconUrl} alt="" width={size} height={size} />
              <code className="muted">{size}px</code>
            </div>
          ))}
          <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <img src="/favicon-16.png" alt="" width={16} height={16} />
            <code className="muted">favicon-16.png</code>
          </div>
          <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
            <img src="/favicon-32.png" alt="" width={32} height={32} />
            <code className="muted">favicon-32.png</code>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Colour</h2>
        <p className="muted">
          One accent and a ladder of quiet neutrals. Status colours are reserved for status, and are
          always paired with an icon and a word.
        </p>
        <div className="grid-2">
          {palette.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
        <h3 style={{ marginTop: 8 }}>Status</h3>
        <div className="grid-2">
          {statusColours.map((c) => (
            <Swatch key={c.token} {...c} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Typography</h2>
        <div className="grid-2">
          <div className="card stack" style={{ gap: 8 }}>
            <span className="eyebrow">Inter</span>
            <p style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              All systems operational
            </p>
            <p className="muted">Body, headings and every sentence of UI copy.</p>
          </div>
          <div className="card stack" style={{ gap: 8 }}>
            <span className="eyebrow">JetBrains Mono</span>
            <p className="mono" style={{ fontSize: 'var(--text-xl)' }}>
              99.982% · 184 ms
            </p>
            <p className="muted">Numbers, durations, percentages and URLs.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Voice</h2>
        <table className="table card" style={{ padding: 0 }}>
          <thead>
            <tr>
              <th>We say</th>
              <th>We avoid</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>harborpine.coffee has been down for 4 minutes.</td>
              <td className="muted">Uh oh! Something went wrong!</td>
            </tr>
            <tr>
              <td>Certificate expires in 7 days.</td>
              <td className="muted">URGENT: SSL ALERT</td>
            </tr>
            <tr>
              <td>Up 99.98% in October.</td>
              <td className="muted">Blazing-fast world-class uptime</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
