import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  DEMO_INSTRUMENTS,
  deriveId,
  generatePriceSeries,
  generateVolSeries,
  isValidSpec,
  opInputs,
  opIsBand,
  opIsMulti,
  opNeedsColumns,
  opOutputs,
  opParams,
  opSharesSourceAxis,
  specUnit,
  studyCatalog,
  studyLevels,
  studyTag,
  TARGET_ROLES,
  type DeriveSpec,
  type OpParam,
} from '@tidal-ts/core';
import { demoDark, demoLight } from '../demoTheme.js';
import {
  configColumns,
  prepareChart,
  TimeSeriesChart,
  type ChartSeries,
  type SeriesConfig,
  type TrackerInfo,
} from '../../src/index.js';
import { STUDY_DOCS } from './docs/index.js';
import { FAMILIES } from './families.js';
import { DEFAULT_BARS } from './types.js';

/**
 * **One study's page**: what it is, how it is traded, its parameters, and a
 * live chart of it on the workshop's fixture data.
 *
 * Hosted exactly like every other story — a literal theme, colours written
 * into the configs, no provider — so each page is also a working example of
 * how a consumer seats a study: build a `DeriveSpec`, hand it to
 * `prepareChart`, draw the rows. The parameter fields are live: change one and
 * the spec, the fold and the chart all follow.
 */

/** The study's own colour: one hue per study, told apart from price by colour
 *  and from its own outputs by texture (the chart's `lines` convention). */
const STUDY_COLOR = { dark: '#a99cf5', light: '#5b4bc4' } as const;
/** Price sits back: a quiet ink, so the study is what the eye lands on. */
const PRICE_COLOR = { dark: '#8b93a8', light: '#6b7280' } as const;
/** Candles are market data, the one place rise/fall colour belongs. */
const RISE = { dark: '#3fb68b', light: '#15803d' } as const;
const FALL = { dark: '#e5534b', light: '#b91c1c' } as const;

const PRICE_H = 260;
const STUDY_H = 170;

/** The hand-declared op that reads a VARIANCE, not a price: it is drawn from
 *  the vol fixture's daily close-to-close variance instead. */
const VOL_STUDIES: Readonly<Record<string, { input: string; context: string; label: string }>> = {
  realizedVol: { input: 'ccVar', context: 'iv21', label: 'Implied vol (21-day ATM)' },
};

const familyOf = (op: string): string => {
  const family = studyCatalog().find((s) => s.op === op)?.family;
  return FAMILIES.find((f) => f.family === family)?.label ?? family ?? 'Other';
};

const summaryOf = (op: string): string => studyCatalog().find((s) => s.op === op)?.summary ?? '';

/** Display names for the bar columns a study can read. */
const COLUMN_WORDS: Readonly<Record<string, string>> = {
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  volume: 'volume',
};

/** The spec a study of `op` reads, bound the way the terminal binds one: the
 *  target role takes `input`, every bar role its own declared column. */
export function studySpec(op: string, params: Record<string, number>, input: string): DeriveSpec {
  const declared = opParams(op);
  const inputs = opInputs(op).map((r) => (TARGET_ROLES.has(r.role) ? input : (r.default ?? input)));
  return {
    op,
    ...(declared.length > 0 ? { params } : {}),
    inputs: inputs.length > 0 ? inputs : [input],
  };
}

const defaults = (op: string): Record<string, number> =>
  Object.fromEntries(opParams(op).map((p) => [p.name, p.default]));

/** A numeric field's legal value: bounded by the registry where it declares a
 *  bound, whole for an integer param. A param with no declared bound is not
 *  clamped — a value the study cannot use shows up as the "no values" notice
 *  instead (see `empty` below). */
const clampParam = (p: OpParam, v: number): number => {
  let x = p.kind === 'integer' ? Math.round(v) : v;
  if (p.min !== undefined) x = Math.max(p.min, x);
  if (p.max !== undefined) x = Math.min(p.max, x);
  return x;
};

/** A param's legal range in words: a bound the registry does not declare is
 *  simply not shown, rather than printed as an infinity. */
const allowed = (p: OpParam): string =>
  p.min !== undefined && p.max !== undefined
    ? `${p.min} … ${p.max}`
    : p.min !== undefined
      ? `≥ ${p.min}`
      : p.max !== undefined
        ? `≤ ${p.max}`
        : 'any';

const fmt = (v: number | undefined): string => {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return v.toExponential(2);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
};

const S = {
  page: {
    maxWidth: 1080,
    margin: '0 auto',
    padding: '12px 8px 48px',
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: 14,
    lineHeight: 1.55,
    color: 'var(--pane-ink)',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: 'var(--pane-ink-faint)',
  },
  h1: { margin: '4px 0 2px', fontSize: 24, fontWeight: 600, color: 'var(--pane-ink-strong)' },
  summary: { margin: '0 0 16px', color: 'var(--pane-ink-muted)' },
  h2: {
    margin: '28px 0 8px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: 'var(--pane-ink-muted)',
  },
  mono: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 12 },
  card: {
    background: 'var(--pane-surface)',
    borderRadius: 6,
    padding: 12,
  },
  well: { background: 'var(--pane-well)', borderRadius: 4 },
  tag: {
    display: 'inline-block',
    padding: '0 8px',
    borderRadius: 10,
    border: '1px solid var(--pane-border)',
    fontSize: 11,
    color: 'var(--pane-ink-muted)',
    marginRight: 6,
  },
  th: {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--pane-ink-faint)',
    padding: '4px 12px 4px 0',
    borderBottom: '1px solid var(--pane-border)',
  },
  td: {
    padding: '6px 12px 6px 0',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--pane-surface-active)',
  },
  input: {
    width: 72,
    font: 'inherit',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: 12,
    padding: '2px 6px',
    borderRadius: 3,
    border: '1px solid var(--pane-border)',
    background: 'var(--pane-well)',
    color: 'var(--pane-ink-strong)',
  },
} satisfies Record<string, CSSProperties>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={S.h2}>{title}</h2>
      {children}
    </section>
  );
}

export interface StudyPageProps {
  op: string;
  scheme?: 'dark' | 'light';
}

export function StudyPage({ op, scheme = 'dark' }: StudyPageProps) {
  const doc = STUDY_DOCS[op];
  const declared = useMemo(() => opParams(op), [op]);
  const [params, setParams] = useState<Record<string, number>>(() => defaults(op));
  const [hover, setHover] = useState<TrackerInfo | null>(null);
  const bars = doc?.bars ?? DEFAULT_BARS;

  const data = useMemo(() => {
    const inst = DEMO_INSTRUMENTS[0]!;
    return {
      price: generatePriceSeries(inst, { bars }) as unknown as ChartSeries,
      vol: generateVolSeries(inst.symbol, { bars }) as unknown as ChartSeries,
    };
  }, [bars]);

  const volStudy = VOL_STUDIES[op];
  const shares = opSharesSourceAxis(op);
  const spec = useMemo(
    () => studySpec(op, params, volStudy?.input ?? 'close'),
    [op, params, volStudy],
  );
  const valid = isValidSpec(spec);
  const outputs = opOutputs(op);
  const levels = studyLevels(op);
  const needs = opNeedsColumns(op);

  const chart = useMemo(() => {
    if (!valid) return null;
    const color = STUDY_COLOR[scheme];
    const source = volStudy ? 'vol' : 'price';
    const study: SeriesConfig = {
      id: 'study',
      column: deriveId(spec),
      label: studyTag(spec),
      color,
      axis: 'L',
      ...(shares ? {} : { axisGroup: 'study' }),
      style: opIsBand(op) ? 'band' : opIsMulti(op) ? 'lines' : 'line',
      visible: true,
      value: null,
      unit: shares ? '' : specUnit(spec, () => ''),
      source,
      derive: spec,
      lineWidth: 1.5,
    };
    const context: SeriesConfig = volStudy
      ? {
          id: 'context',
          column: volStudy.context,
          label: volStudy.label,
          color: PRICE_COLOR[scheme],
          axis: 'L',
          style: 'line',
          visible: true,
          value: null,
          unit: '%',
          source: 'vol',
        }
      : {
          id: 'price',
          column: 'close',
          label: 'Price',
          color: PRICE_COLOR[scheme],
          axis: 'L',
          style: 'candle',
          colorMode: 'split',
          riseColor: RISE[scheme],
          fallColor: FALL[scheme],
          visible: true,
          value: null,
          unit: '',
          source: 'price',
        };
    const rows = shares
      ? [{ id: 'price', configs: [context, study] }]
      : [
          { id: 'price', configs: [context] },
          { id: 'study', configs: [study] },
        ];
    const prepared = prepareChart(
      { price: { series: data.price }, vol: { series: data.vol } },
      rows,
    );
    // A spec can pass validation and still compute nothing: a param with no
    // declared bound (a slow period below the fast one, a zero limit) is not
    // refused by the registry, the study just yields no values. Say so rather
    // than leave a blank panel.
    const carried = prepared.facts.columns[source];
    const empty = !configColumns(study).some((c) => carried?.has(c));
    return {
      empty,
      sources: prepared.sources,
      rows: prepared.rows.map((r) => ({
        ...r,
        height: r.id === 'price' ? (shares ? PRICE_H + STUDY_H : PRICE_H) : STUDY_H,
      })),
    };
  }, [valid, spec, op, shares, volStudy, scheme, data]);

  if (!doc) {
    return <div style={S.page}>No catalog entry for “{op}”.</div>;
  }

  // A single-output study reads by its short name (`RSI`, from the page title's
  // parenthesis) and its params; a multi-output one by each output's suffix.
  const short = /\(([^)]+)\)\s*$/.exec(doc.name)?.[1] ?? doc.name;
  const tuned = declared.map((p) => spec.params?.[p.name] ?? p.default);
  const single = tuned.length > 0 ? `${short} (${tuned.join(', ')})` : short;
  const outputName = (suffix: string): string =>
    suffix === '' || outputs.length < 2 ? single : suffix;

  return (
    <article style={S.page}>
      <div style={S.eyebrow}>Studies · {familyOf(op)}</div>
      <h1 style={S.h1}>{doc.name}</h1>
      <p style={S.summary}>
        <span style={{ ...S.mono, color: 'var(--pane-ink-faint)' }}>{op}</span> · {summaryOf(op)}
      </p>

      <div style={S.card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <span style={S.tag}>{shares ? 'Drawn over price' : 'Drawn in its own panel'}</span>
          {needs.length > 0 ? (
            <span style={S.tag}>Reads {needs.map((c) => COLUMN_WORDS[c] ?? c).join(', ')}</span>
          ) : (
            <span style={S.tag}>
              Reads {volStudy ? 'a daily variance' : 'one column (close here)'}
            </span>
          )}
          {levels.length > 0 ? <span style={S.tag}>Guide lines at {levels.join(', ')}</span> : null}
        </div>
        {chart?.empty ? (
          <div style={{ padding: '4px 0 8px', color: 'var(--pane-ink-strong)', fontSize: 13 }}>
            These settings produce no values — for example a slow period shorter than the fast one,
            or a zero or negative setting. Try values closer to the defaults.
          </div>
        ) : null}
        <div style={S.well}>
          {chart ? (
            <TimeSeriesChart
              rows={chart.rows}
              sources={chart.sources}
              ohlcSources={volStudy ? [] : ['price']}
              theme={scheme === 'light' ? demoLight : demoDark}
              colorScheme={scheme}
              onTracker={setHover}
            />
          ) : (
            <div style={{ padding: 24, color: 'var(--pane-ink-muted)' }}>
              These settings are outside the study’s legal range.
            </div>
          )}
        </div>
        <Readout hover={hover} outputs={outputs} band={opIsBand(op)} name={outputName} />
      </div>

      <Section title="What it measures">
        <p style={{ margin: 0 }}>{doc.what}</p>
      </Section>

      <Section title="How traders use it">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {doc.uses.map((u) => (
            <li key={u} style={{ marginBottom: 6 }}>
              {u}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Parameters">
        {declared.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--pane-ink-muted)' }}>
            None — the study is fully defined by its formula.
          </p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={S.th}>Name</th>
                <th style={S.th}>Value</th>
                <th style={S.th}>Default</th>
                <th style={S.th}>Allowed</th>
                <th style={S.th}>What it does</th>
              </tr>
            </thead>
            <tbody>
              {declared.map((p) => (
                <tr key={p.name}>
                  <td style={{ ...S.td, ...S.mono, color: 'var(--pane-ink-strong)' }}>{p.name}</td>
                  <td style={S.td}>
                    <ParamField
                      param={p}
                      value={params[p.name] ?? p.default}
                      onChange={(v) => setParams((cur) => ({ ...cur, [p.name]: v }))}
                    />
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{p.default}</td>
                  <td style={{ ...S.td, ...S.mono, whiteSpace: 'nowrap' }}>
                    {allowed(p)}
                    {p.suggest ? (
                      <div style={{ color: 'var(--pane-ink-faint)' }}>
                        usual {p.suggest[0]}–{p.suggest[1]}
                      </div>
                    ) : null}
                  </td>
                  <td style={S.td}>{doc.params?.[p.name] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {outputs.length > 1 ? (
        <Section title="Outputs">
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {outputs.map((o) => (
                <tr key={o}>
                  <td style={{ ...S.td, ...S.mono, width: 120, color: 'var(--pane-ink-strong)' }}>
                    {o}
                  </td>
                  <td style={S.td}>{doc.outputs?.[o] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: '8px 0 0', color: 'var(--pane-ink-muted)', fontSize: 13 }}>
            {opIsBand(op)
              ? 'Drawn as one shaded band: the middle line with the upper and lower edges.'
              : 'Drawn in one colour, one line per output, told apart by line texture. Hover the chart to read each one.'}
          </p>
        </Section>
      ) : null}

      {doc.note ? (
        <Section title="Good to know">
          <p style={{ margin: 0 }}>{doc.note}</p>
        </Section>
      ) : null}
    </article>
  );
}

/** A param's field: typed freely, applied when the value is a number, clamped
 *  to the registry's legal range on blur. */
function ParamField({
  param,
  value,
  onChange,
}: {
  param: OpParam;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const v = clampParam(param, n);
    setText(String(v));
    onChange(v);
  };
  return (
    <input
      style={S.input}
      type="number"
      aria-label={param.name}
      value={text}
      step={param.kind === 'integer' ? 1 : 0.1}
      min={param.min}
      max={param.max}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && clampParam(param, n) === n) {
          onChange(n);
        }
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
      }}
    />
  );
}

/** OHLC in reading order, then everything else as the chart reported it. */
const OHLC = ['price open', 'price high', 'price low', 'price close'];
const ordered = (values: TrackerInfo['values']): TrackerInfo['values'] => [
  ...OHLC.flatMap((k) => values.filter((v) => v.label === k)),
  ...values.filter((v) => !OHLC.includes(v.label)),
];

/** The hover readout under the chart: the bar's date, then each drawn value,
 *  named by the output it is. */
function Readout({
  hover,
  outputs,
  band,
  name,
}: {
  hover: TrackerInfo | null;
  outputs: readonly string[];
  band: boolean;
  name: (suffix: string) => string;
}) {
  const label = (raw: string): string => {
    if (raw.startsWith('price '))
      return raw.slice('price '.length).replace(/^\w/, (c) => c.toUpperCase());
    if (raw === 'price') return 'Close';
    if (raw === 'context') return 'Implied vol';
    const o = /^study__o(\d+)$/.exec(raw);
    if (o) {
      const i = Number(o[1]);
      return name(outputs[i] ?? '');
    }
    if (raw.startsWith('study '))
      return raw.slice('study '.length).replace(/^\w/, (c) => c.toUpperCase());
    // A band's centre line reports under the bare id, whatever order the
    // study declared its outputs in (Donchian lists Upper first).
    if (raw === 'study') return band ? 'Middle' : name(outputs[0] ?? '');
    return raw;
  };
  return (
    <div
      style={{
        ...S.mono,
        minHeight: 20,
        marginTop: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 16px',
        color: 'var(--pane-ink-muted)',
      }}
    >
      {hover ? (
        <>
          <span>{new Date(hover.time).toISOString().slice(0, 10)}</span>
          {ordered(hover.values).map((v) => (
            <span key={v.label}>
              <span style={{ color: v.color }}>■</span> {label(v.label)}{' '}
              <span style={{ color: 'var(--pane-ink-strong)' }}>{fmt(v.value)}</span>
            </span>
          ))}
        </>
      ) : (
        <span style={{ color: 'var(--pane-ink-faint)' }}>
          Hover the chart to read values · practice data: a seeded random walk with no overnight
          gaps
        </span>
      )}
    </div>
  );
}
