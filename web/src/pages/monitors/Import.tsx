import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Download, FileUp, Globe, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Segmented } from '../../components/Segmented';
import { ErrorState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { api, ApiError } from '../../lib/api';
import { useClients } from '../../lib/clients';

type Row = {
  line: number;
  name: string;
  url: string;
  client: string;
  intervalSec: number;
  errors: string[];
  newClient: boolean;
};
type SitemapUrl = { url: string; alreadyMonitored: boolean };
type Step = 'source' | 'review' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: 'Choose sites' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

function Steps({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="steps" aria-label="Import progress">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={i === index ? 'is-current' : i < index ? 'is-done' : undefined}
          aria-current={i === index ? 'step' : undefined}
        >
          <span className="step-num">{i < index ? <Check size={12} /> : i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

// CSV quoting: wrap in quotes and double any quote inside.
const csvField = (value: string) => '"' + value.replace(/"/g, '""') + '"';

const messageOf = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Could not reach Northstar. Try again.';

function CsvSource({ onRows }: { onRows: (rows: Row[]) => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: () =>
      api<{ rows: Row[] }>('/monitors/import/preview', { method: 'POST', body: { csv } }),
    onSuccess: (res) => onRows(res.rows),
  });

  return (
    <div className="stack">
      <p className="muted">
        One site per line, with the columns <code>name</code>, <code>url</code>, <code>client</code>{' '}
        and <code>interval</code> (seconds). Only <code>url</code> is required. Clients that do not
        exist yet are created.{' '}
        <a
          href="/northstar-import-template.csv"
          download
          className="row"
          style={{ display: 'inline-flex', gap: 4 }}
        >
          <Download size={14} /> Download the template
        </a>
      </p>
      <label
        className="card stack"
        style={{
          alignItems: 'center',
          textAlign: 'center',
          cursor: 'pointer',
          borderStyle: 'dashed',
          gap: 8,
        }}
      >
        <FileUp size={22} className="muted" aria-hidden="true" />
        <span>{fileName ?? 'Choose a CSV file'}</span>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Up to 500 rows
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setCsv(await file.text());
          }}
        />
      </label>
      <div className="field">
        <label htmlFor="csv">Or paste it here</label>
        <textarea
          id="csv"
          className="input mono"
          rows={6}
          style={{ height: 'auto', padding: 10, fontSize: 'var(--text-xs)' }}
          placeholder={
            'name,url,client,interval\nHarbor & Pine shop,https://shop.harborpine.coffee,Harbor & Pine Coffee,60'
          }
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
      </div>
      {preview.isError && <ErrorState message={messageOf(preview.error)} />}
      <div>
        <button
          className="btn btn-primary"
          disabled={!csv.trim() || preview.isPending}
          onClick={() => preview.mutate()}
        >
          {preview.isPending ? 'Checking every row…' : 'Check these sites'}
        </button>
      </div>
    </div>
  );
}

function SitemapSource({ onRows }: { onRows: (rows: Row[]) => void }) {
  const clients = useClients();
  const [urls, setUrls] = useState<SitemapUrl[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [client, setClient] = useState('');
  const [intervalSec, setIntervalSec] = useState(300);

  const read = useMutation({
    mutationFn: (url: string) =>
      api<{ urls: SitemapUrl[] }>('/monitors/sitemap/preview', { method: 'POST', body: { url } }),
    onSuccess: (res) => {
      setUrls(res.urls);
      setSelected(new Set(res.urls.filter((u) => !u.alreadyMonitored).map((u) => u.url)));
    },
  });

  const preview = useMutation({
    mutationFn: () => {
      const lines = [...selected].map((u) => `,${csvField(u)},${csvField(client)},${intervalSec}`);
      return api<{ rows: Row[] }>('/monitors/import/preview', {
        method: 'POST',
        body: { csv: ['name,url,client,interval', ...lines].join('\n') },
      });
    },
    onSuccess: (res) => onRows(res.rows),
  });

  function onRead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    read.mutate(String(new FormData(e.currentTarget).get('sitemap')));
  }

  const toggle = (url: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  return (
    <div className="stack">
      <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onRead}>
        <div className="field" style={{ flex: '1 1 320px' }}>
          <label htmlFor="sitemap">Sitemap address</label>
          <input
            id="sitemap"
            name="sitemap"
            className="input mono"
            placeholder="https://harborpine.coffee/sitemap.xml"
            required
          />
        </div>
        <button className="btn" type="submit" disabled={read.isPending}>
          {read.isPending ? 'Reading…' : 'Read sitemap'}
        </button>
      </form>
      {read.isError && <ErrorState message={messageOf(read.error)} />}

      {urls && urls.length === 0 && <p className="muted">That sitemap lists no pages.</p>}
      {urls && urls.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">
              {urls.length} pages found, {selected.size} selected
            </span>
            <div className="row">
              <button
                className="btn btn-ghost"
                onClick={() =>
                  setSelected(new Set(urls.filter((u) => !u.alreadyMonitored).map((u) => u.url)))
                }
              >
                Select all
              </button>
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
                Select none
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: 0, maxHeight: 340, overflowY: 'auto' }}>
            {urls.map((u) => (
              <label
                key={u.url}
                className="row"
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--line)',
                  gap: 10,
                  cursor: u.alreadyMonitored ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.url)}
                  disabled={u.alreadyMonitored}
                  onChange={() => toggle(u.url)}
                />
                <span
                  className="mono"
                  style={{ fontSize: 'var(--text-xs)', flex: 1, wordBreak: 'break-all' }}
                >
                  {u.url}
                </span>
                {u.alreadyMonitored && (
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    Already monitored
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label htmlFor="sitemap-client">Client</label>
              <select
                id="sitemap-client"
                className="input"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              >
                <option value="">No client</option>
                {clients.data?.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sitemap-interval">Check every</label>
              <select
                id="sitemap-interval"
                className="input"
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
              >
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              disabled={selected.size === 0 || preview.isPending}
              onClick={() => preview.mutate()}
            >
              Review {selected.size} pages
            </button>
          </div>
          {preview.isError && <ErrorState message={messageOf(preview.error)} />}
        </>
      )}
    </div>
  );
}

function Review({
  rows,
  onBack,
  onDone,
}: {
  rows: Row[];
  onBack: () => void;
  onDone: (n: number) => void;
}) {
  const qc = useQueryClient();
  const valid = rows.filter((r) => r.errors.length === 0);
  const newClients = new Set(valid.filter((r) => r.newClient).map((r) => r.client));
  const commit = useMutation({
    mutationFn: () =>
      api<{ created: number }>('/monitors/import/commit', {
        method: 'POST',
        body: {
          rows: valid.map(({ name, url, client, intervalSec }) => ({
            name,
            url,
            client,
            intervalSec,
          })),
        },
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries();
      onDone(res.created);
    },
  });

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p>
          <strong className="num">{valid.length}</strong> of {rows.length} sites are ready to add
          {newClients.size > 0 && (
            <span className="muted">
              {' '}
              · {newClients.size} new client{newClients.size === 1 ? '' : 's'}:{' '}
              {[...newClients].join(', ')}
            </span>
          )}
          .
        </p>
        {rows.length > valid.length && (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            Rows with problems are skipped. Fix them in the file and import again.
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto', maxHeight: 460 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Status</th>
              <th>Name</th>
              <th>Address</th>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Every</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line}>
                <td className="num muted">{r.line}</td>
                <td>
                  {r.errors.length ? (
                    <div className="stack" style={{ gap: 4, justifyItems: 'start' }}>
                      <StatusBadge status="down" label="Skipped" />
                      <span style={{ fontSize: 'var(--text-xs)' }}>{r.errors.join('. ')}</span>
                    </div>
                  ) : (
                    <StatusBadge status="up" label="Ready" />
                  )}
                </td>
                <td>{r.name}</td>
                <td
                  className="mono muted"
                  style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}
                >
                  {r.url}
                </td>
                <td>
                  {r.client || <span className="muted">—</span>}
                  {r.newClient && (
                    <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                      {' '}
                      (new)
                    </span>
                  )}
                </td>
                <td className="num" style={{ textAlign: 'right' }}>
                  {r.intervalSec}s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {commit.isError && <ErrorState message={messageOf(commit.error)} />}
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={valid.length === 0 || commit.isPending}
          onClick={() => commit.mutate()}
        >
          {commit.isPending
            ? 'Adding…'
            : `Add ${valid.length} monitor${valid.length === 1 ? '' : 's'}`}
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export function Import() {
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<'csv' | 'sitemap'>('csv');
  const [rows, setRows] = useState<Row[]>([]);
  const [created, setCreated] = useState(0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import sites</h1>
          <p className="muted">Add many monitors at once, from a spreadsheet or a sitemap.</p>
        </div>
        <Link className="btn btn-ghost" to="/" aria-label="Close">
          <X size={16} />
        </Link>
      </div>
      <Steps current={step} />
      <div className="card" style={{ maxWidth: 960 }}>
        {step === 'source' && (
          <div className="stack" style={{ gap: 20 }}>
            <Segmented
              label="Import from"
              value={source}
              onChange={setSource}
              options={[
                { value: 'csv', label: 'CSV file' },
                { value: 'sitemap', label: 'Sitemap' },
              ]}
            />
            {source === 'csv' ? (
              <CsvSource
                onRows={(r) => {
                  setRows(r);
                  setStep('review');
                }}
              />
            ) : (
              <SitemapSource
                onRows={(r) => {
                  setRows(r);
                  setStep('review');
                }}
              />
            )}
          </div>
        )}
        {step === 'review' && (
          <Review
            rows={rows}
            onBack={() => setStep('source')}
            onDone={(n) => {
              setCreated(n);
              setStep('done');
            }}
          />
        )}
        {step === 'done' && (
          <div
            className="stack"
            style={{ alignItems: 'center', textAlign: 'center', padding: '24px 0' }}
          >
            <Globe size={28} color="var(--accent)" aria-hidden="true" />
            <h2>
              {created} monitor{created === 1 ? '' : 's'} added
            </h2>
            <p className="muted">
              The first checks run within a minute. Certificates and domains appear on the
              expirations page soon after.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn btn-primary" to="/">
                Go to the overview
              </Link>
              <button
                className="btn"
                onClick={() => {
                  setRows([]);
                  setStep('source');
                }}
              >
                Import more
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
