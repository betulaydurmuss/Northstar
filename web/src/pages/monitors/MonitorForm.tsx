import { zodResolver } from '@hookform/resolvers/zod';
import {
  LIMITS,
  monitorInput,
  usesHttp,
  type MonitorFormValues,
  type MonitorInput,
} from '@northstar/shared/monitor';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSearch, Globe, Radio } from 'lucide-react';
import { useForm, type Path } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, Skeleton } from '../../components/States';
import { api, ApiError } from '../../lib/api';
import { useClients } from '../../lib/clients';
import { useMonitor, type Monitor } from '../../lib/monitors';

const defaults: MonitorFormValues = {
  name: '',
  type: 'http',
  target: '',
  intervalSec: LIMITS.intervalSec.default,
  timeoutMs: LIMITS.timeoutMs.default,
  retries: LIMITS.retries.default,
  clientId: null,
  keyword: null,
  keywordMode: 'present',
  keywordCaseSensitive: false,
};

const INTERVALS = [30, 60, 120, 300];

function Form({ initial, id }: { initial: MonitorFormValues; id?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MonitorFormValues, unknown, MonitorInput>({
    resolver: zodResolver(monitorInput),
    defaultValues: initial,
  });
  const type = watch('type');
  const clients = useClients();

  const save = useMutation({
    mutationFn: (values: MonitorInput) =>
      api<Monitor>(id ? `/monitors/${id}` : '/monitors', {
        method: id ? 'PATCH' : 'POST',
        body: values,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['monitors'] });
      navigate('/');
    },
    onError: (err) => {
      // Put server-side field errors next to the field they belong to.
      const details =
        err instanceof ApiError ? (err.details as { path: string; message: string }[]) : null;
      if (details?.length) {
        for (const d of details)
          setError(d.path as Path<MonitorFormValues>, { message: d.message });
      } else if (err instanceof ApiError && /address|host/i.test(err.message)) {
        setError('target', { message: err.message });
      } else {
        setError('root', { message: err.message });
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/monitors/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['monitors'] });
      navigate('/');
    },
  });

  return (
    <form
      className="card stack"
      style={{ gap: 20, maxWidth: 640 }}
      onSubmit={handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))}
      noValidate
    >
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginBottom: 6 }}>
          What should we check?
        </legend>
        <div className="row" role="radiogroup">
          {(
            [
              ['http', Globe, 'Website', 'An HTTP request; up on any 2xx or 3xx answer'],
              [
                'keyword',
                FileSearch,
                'Page content',
                'Up only if the page shows (or hides) a phrase',
              ],
              ['ping', Radio, 'Server', 'A TCP connection to a host and port'],
            ] as const
          ).map(([value, Icon, label, hint]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              className="card"
              onClick={() => setValue('type', value, { shouldValidate: false })}
              style={{
                flex: 1,
                minWidth: 160,
                textAlign: 'left',
                cursor: 'pointer',
                padding: 14,
                font: 'inherit',
                color: 'inherit',
                borderColor: type === value ? 'var(--accent)' : 'var(--line)',
                boxShadow: type === value ? '0 0 0 3px var(--accent-soft)' : 'none',
              }}
            >
              <span className="row" style={{ gap: 8, fontWeight: 600 }}>
                <Icon size={16} aria-hidden="true" /> {label}
              </span>
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {hint}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="name">Name</label>
        <input
          id="name"
          className="input"
          placeholder="Harbor & Pine Coffee"
          {...register('name')}
        />
        {errors.name && <span className="field-error">{errors.name.message}</span>}
      </div>

      <div className="field">
        <label htmlFor="target">{usesHttp(type) ? 'URL' : 'Host and port'}</label>
        <input
          id="target"
          className="input mono"
          placeholder={usesHttp(type) ? 'https://harborpine.coffee' : 'mail.harborpine.coffee:587'}
          autoComplete="off"
          spellCheck={false}
          {...register('target')}
        />
        {errors.target ? (
          <span className="field-error">{errors.target.message}</span>
        ) : (
          type === 'ping' && (
            <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
              Without a port we connect to 443.
            </span>
          )
        )}
      </div>

      {type === 'keyword' && (
        <div className="grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="field">
            <label htmlFor="keyword">Phrase</label>
            <input
              id="keyword"
              className="input"
              placeholder="Order online"
              {...register('keyword')}
            />
            {errors.keyword ? (
              <span className="field-error">{errors.keyword.message}</span>
            ) : (
              <label className="row muted" style={{ gap: 6, fontSize: 'var(--text-xs)' }}>
                <input type="checkbox" {...register('keywordCaseSensitive')} /> Match upper and
                lower case exactly
              </label>
            )}
          </div>
          <div className="field">
            <label htmlFor="keywordMode">The page is up when the phrase is</label>
            <select id="keywordMode" className="input" {...register('keywordMode')}>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
            </select>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="clientId">Client</label>
        <select id="clientId" className="input" {...register('clientId')}>
          <option value="">No client</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div
        className="grid-2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
      >
        <div className="field">
          <label htmlFor="intervalSec">Check every</label>
          <select id="intervalSec" className="input" {...register('intervalSec')}>
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`}
              </option>
            ))}
          </select>
          {errors.intervalSec && <span className="field-error">{errors.intervalSec.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="timeoutMs">Timeout (ms)</label>
          <input
            id="timeoutMs"
            type="number"
            className="input mono"
            step={1000}
            min={LIMITS.timeoutMs.min}
            max={LIMITS.timeoutMs.max}
            {...register('timeoutMs')}
          />
          {errors.timeoutMs && <span className="field-error">{errors.timeoutMs.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="retries">Retries before alerting</label>
          <select id="retries" className="input" {...register('retries')}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {errors.retries && <span className="field-error">{errors.retries.message}</span>}
        </div>
      </div>

      {errors.root && <ErrorState message={errors.root.message ?? 'Could not save the monitor.'} />}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
            {id ? 'Save changes' : 'Start monitoring'}
          </button>
          <Link className="btn btn-ghost" to="/">
            Cancel
          </Link>
        </div>
        {id && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('Delete this monitor and its history?')) remove.mutate();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

export function NewMonitor() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add a monitor</h1>
          <p className="muted">The first check runs as soon as you save.</p>
        </div>
      </div>
      <Form initial={defaults} />
    </>
  );
}

export function EditMonitor() {
  const { id } = useParams();
  const monitor = useMonitor(id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Edit monitor</h1>
          <p className="muted">{monitor.data?.name ?? ' '}</p>
        </div>
      </div>
      {monitor.isPending ? (
        <Skeleton rows={4} height={44} />
      ) : monitor.isError ? (
        <ErrorState message="This monitor could not be found." />
      ) : (
        <Form
          id={id}
          initial={{ ...monitor.data, keywordMode: monitor.data.keywordMode ?? 'present' }}
        />
      )}
    </>
  );
}
