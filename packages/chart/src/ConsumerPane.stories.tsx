import { useCallback, useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import {
  DEMO_INSTRUMENTS,
  deriveId,
  generatePriceSeries,
  generateVolSeries,
  type DeriveSpec,
} from '@tidal-ts/core';
import { demoDark, demoLight } from '../.storybook/demoTheme.js';
import {
  PresetSlots,
  SelectLabel,
  SelectPill,
  SelectorGroup,
  SeriesCheckbox,
  ToggleGroup,
  paneStyles as S,
} from '../.storybook/paneAtoms.js';
import { centerOnZero, configAxisId, prepareChart, TimeSeriesChart } from './index.js';
import type { ChartSeries, SeriesConfig, TimeSeriesChartRow } from './index.js';

/**
 * **A consumer pane** — the shape an embedding application actually wants, as
 * opposed to the terminal this chart came out of.
 *
 * The difference is the whole reason the chart is a package. A terminal offers
 * an open-ended catalog: add any metric, lay a study on it, recolour it, give it
 * its own axis. A pane inside a larger application does the opposite — it has a
 * **closed, named curve vocabulary**, styles them itself, and gives the user a
 * few fixed choices. No add-a-series menu, no study picker, no swatch grid.
 *
 * So this story drives `TimeSeriesChart` from a simplified UI of its own:
 *
 * - a fixed catalog of eight curves, four on by default, **capped at six** —
 *   past the cap the remaining checkboxes go inert rather than silently
 *   dropping one, because a curve that vanishes on a click is worse than a
 *   control that says no;
 * - **one y-axis column per active curve**, each in its curve's own colour
 *   (`axisGroup` per config — the same mechanism a terminal's "unlink" uses,
 *   here applied by the pane rather than by the user);
 * - **a second ROW for the relatives**, a third of the chart and draggable. A
 *   relative is a different KIND of reading from a level: it has a meaningful
 *   zero and a level does not, so a crossing between the two in one rectangle
 *   is visually loud and means nothing. Every axis in that row is centred on
 *   zero (`centerOnZero`), which is what puts each curve's zero on the SAME
 *   rule without pretending a log ratio and a percentage share a unit —
 *   symmetric axes agree on where zero is whatever their magnitudes. That is
 *   also why the term-structure curve is a `logRatio` and not a `ratio`: a
 *   plain ratio is neutral at 1, and an axis mirrored about 0 would spend half
 *   itself on values it never takes. One time axis under both rows;
 * - **a confidence envelope under two of the curves** — a `bollinger` spec
 *   drawn as `style: 'band'`, sharing its curve's `axisGroup` so the band
 *   scales with the line it belongs to instead of claiming a gutter column of
 *   its own. It is still inside the extent that axis has to cover, so a band
 *   WIDENS its curve's scale — the cost it does have. Fixed by the pane, not
 *   added by a user: on this surface the envelope is part of what the curve
 *   MEANS;
 * - an expiry radio group and a day-range segmented control, which change what
 *   is asked for rather than what is drawn;
 * - colours, labels and units decided by the pane, so no `resolveColor` is
 *   passed at all and the chart never sees a design token.
 *
 * Two of the eight curves are **derived** (a ratio and a difference between two
 * columns), built as `DeriveSpec`s and folded by `prepareChart` — a pane gets
 * the study engine without shipping a study menu.
 *
 * **Why six.** The cap is not a taste call — it is the gutter's price. Every
 * active curve takes its own tick column, so the chrome grows with the data and
 * a pane that allowed its whole catalog at once would be mostly axis. Six is
 * where the gutter still leaves the plot more than half the width.
 *
 * **What this pane cannot say yet.** A closed vocabulary wants TEXTURE as a
 * channel it controls: a censored twin drawn in its sibling's hue and a dash,
 * a benchmark-relative curve dashed so it reads as derived with no legend.
 *
 * A `SeriesConfig` has no texture field. `seriesCategoryStyle` answers for one:
 * `comparisons` when the spec reads the compare symbol, else `derived` when it
 * is WINDOWED (`isStudySeries` — an op with params), else `metrics`; each
 * category is solid-or-dashed from a single `DASH_PATTERN`. Both relatives here
 * are pointwise (`ratio`/`diff` declare no params), so they land in `metrics`
 * and draw exactly like a raw column. Dashing that category would dash every
 * raw curve with them.
 *
 * The chart is not textureless — a multi-output study's 2nd..Nth lines take a
 * dash ladder, and a comparison counterpart is dashed automatically. Both are
 * textures the CHART assigns; neither is one a pane can ask for. So colour is
 * this pane's only free channel, which is why the censored pair are two hues
 * rather than one hue and two textures. Written down rather than worked around:
 * a per-series texture is a change to `SeriesConfig` AND to what dash means on
 * this chart (today it encodes the comparison symbol), which is a decision for
 * a consumer to ask for, not one for a story to force.
 *
 * **The rows are the host's arithmetic.** `TimeSeriesChartRow.height` is
 * RESOLVED pixels — the chart takes no fractions and does no remainder math —
 * so the split, its clamps and the drag that moves it all live here. The grip
 * is an overlay the pane positions from the height it already owns. That is the
 * seam working: the library draws rows, the host decides how tall they are.
 *
 * Everything outside the plot is the pane's own (`.storybook/paneAtoms.tsx`)
 * and deliberately not part of the package: the library owns the drawing, the
 * host owns the chrome — including the WELL the chart sits in, one step off the
 * pane's ground (darker in dark, lighter in light), which is the only thing
 * separating the reading surface from the controls above it.
 */
const priceSeries = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 180 });
const volSeries = generateVolSeries('AAPL', { bars: 180 });
const sources = { vol: volSeries, price: priceSeries } as unknown as Record<string, ChartSeries>;

/**
 * A categorical ladder the pane owns, **one per scheme**. A consumer's design
 * system supplies these; the chart only ever sees the resolved colour on a
 * config.
 *
 * Two ladders rather than one, because a curve colour is not only a stroke on
 * the canvas — the pane also prints it as label text and fills a checkbox with
 * it. The dark ladder's pastels are a stroke that works and body text that does
 * not once the ground turns to paper (a checked label ran 1.6:1 on white). So
 * light deepens every hue to carry 4.5:1 as ink, which is the same move a
 * designed light theme makes for its series strokes.
 */
const LADDER_DARK = [
  '#f0cb62',
  '#7caefd',
  '#79e295',
  '#fc8d82',
  '#73cdde',
  '#b99eef',
  '#ffa657',
  '#f986b8',
] as const;

const LADDER_LIGHT = [
  '#7a5c00',
  '#1a5cb8',
  '#1f7a3d',
  '#b5372c',
  '#11697a',
  '#6b3fc0',
  '#98520a',
  '#a63a6b',
] as const;

/**
 * A LOG ratio, not a plain one — and the difference is the whole reason the
 * relatives row can be centred on zero.
 *
 * A plain `iv21 / iv63` is neutral at **1**: the two tenors agreeing reads as
 * 1.0, and mirroring such an axis about 0 spends half of it on values the
 * quantity never takes while putting the line that matters up against the
 * frame. `logRatio` is neutral at **0**, like `diff` — so both curves in that
 * row share a meaningful zero, and the rule under them says the same thing for
 * each: the two legs agree.
 */
const ratio: DeriveSpec = { op: 'logRatio', inputs: ['iv21', 'iv63'] };
const spread: DeriveSpec = { op: 'diff', inputs: ['iv21', 'rvcc21'] };

/** The envelope under a banded curve — the same `bollinger` op a terminal
 *  offers in its study menu, here nailed down by the pane. One period and one
 *  width for every band on the pane: envelopes at several weights would read as
 *  several different things rather than one convention.
 *
 *  One standard deviation, not the textbook two: the band has to stay a HINT
 *  under its line. At 2σ a vol spike inflates the envelope until it is the
 *  loudest thing in the plot and drags its curve's axis out with it — the band
 *  is inside the extent the axis has to cover. */
const envelope = (column: string): DeriveSpec => ({
  op: 'bollinger',
  inputs: [column],
  params: { period: 20, stdDev: 1 },
});

/** The pane's CLOSED vocabulary: what this chart is for, named once. A user can
 *  turn these on and off and nothing else — there is no path to a ninth curve. */
interface Curve {
  key: string;
  label: string;
  column: string;
  source: 'vol' | 'price';
  unit: string;
  group: 'level' | 'relative';
  derive?: DeriveSpec;
  /** Carries a confidence envelope. A property of the CURVE, not a user choice
   *  — the vocabulary says which readings come with a band. */
  band?: boolean;
}
const CATALOG: readonly Curve[] = [
  {
    key: 'iv21',
    label: 'ATM Vol 21D',
    column: 'iv21',
    source: 'vol',
    unit: '%',
    group: 'level',
    band: true,
  },
  {
    key: 'hv21',
    label: 'ATM Vol 21D · censored',
    column: 'hv21',
    source: 'vol',
    unit: '%',
    group: 'level',
  },
  {
    key: 'rv21',
    label: 'Realized 21D',
    column: 'rvcc21',
    source: 'vol',
    unit: '%',
    group: 'level',
  },
  {
    key: 'iv252',
    label: 'ATM Vol 252D',
    column: 'iv252',
    source: 'vol',
    unit: '%',
    group: 'level',
    band: true,
  },
  { key: 'price', label: 'Price', column: 'close', source: 'price', unit: '$', group: 'level' },
  {
    key: 'emove',
    label: 'Expected move',
    column: 'iEMove',
    source: 'vol',
    unit: '%',
    group: 'level',
  },
  {
    key: 'termRatio',
    label: 'log(21D / 63D)',
    column: deriveId(ratio),
    source: 'vol',
    unit: '',
    group: 'relative',
    derive: ratio,
  },
  {
    key: 'volSpread',
    label: 'ATM − Realized',
    column: deriveId(spread),
    source: 'vol',
    unit: '%',
    group: 'relative',
    derive: spread,
  },
];
const colorOf = (key: string, scheme: 'dark' | 'light') => {
  const ladder = scheme === 'light' ? LADDER_LIGHT : LADDER_DARK;
  return ladder[CATALOG.findIndex((c) => c.key === key) % ladder.length]!;
};

const LEVELS_ROW = 'levels';
const RELATIVES_ROW = 'relatives';
/** The chart's total height in px. The host resolves rows into pixels — the
 *  chart takes no fractions and does no remainder math. */
const CHART_H = 400;
const REL_MIN = 70;
const REL_MAX = 240;

/**
 * A column's finite extent, read COLUMNAR — `column(name)` and `read(i)`, never
 * `toObjects()` (see `test/columnarDiscipline.test.ts`). Only the relatives
 * need it, and only to hand `centerOnZero` something to mirror.
 */
type NumericColumn = { length: number; read(i: number): number | null | undefined };
const extent = (series: ChartSeries, column: string): { min: number; max: number } | null => {
  const col = (series as unknown as { column(n: string): NumericColumn | undefined }).column(
    column,
  );
  if (!col) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < col.length; i += 1) {
    const v = col.read(i);
    if (v != null && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min <= max ? { min, max } : null;
};

const MAX_ACTIVE = 6;
/** Three levels and both relatives, so the story opens on the case the second
 *  row exists FOR — and on both of its unit families at once (a ratio and a
 *  difference, which is exactly why the row cannot have one shared scale). */
const DEFAULT_ON = ['iv21', 'hv21', 'price', 'termRatio', 'volSpread'];
const EXPIRIES = ['20 Jun 26', '18 Jul 26', '15 Aug 26', '19 Sep 26'];
const DAY_RANGES = [
  { value: '1', label: 'Today' },
  { value: '2', label: '2 Days' },
  { value: '5', label: '1 Week' },
  { value: '10', label: '2 Weeks' },
] as const;

function Pane({ scheme }: { scheme: 'dark' | 'light' }) {
  const [on, setOn] = useState<readonly string[]>(DEFAULT_ON);
  const [expiry, setExpiry] = useState(EXPIRIES[0]!);
  const [days, setDays] = useState<(typeof DAY_RANGES)[number]['value']>('5');
  const [bands, setBands] = useState(true);
  const [relH, setRelH] = useState(Math.round(CHART_H / 3));
  const wellRef = useRef<HTMLDivElement>(null);

  // The grip. `TimeSeriesChartRow.height` is RESOLVED pixels, so the gesture and
  // the clamping belong to the host — this is the smallest honest version of
  // what the terminal's row drag does.
  const onGripDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const well = wellRef.current;
    if (!well) return;
    // Measured from the well's TOP, where the rows start — the time axis eats
    // the bottom of the well, so the boundary is not `bottom - y`.
    const top = well.getBoundingClientRect().top;
    const move = (ev: PointerEvent) =>
      setRelH(Math.max(REL_MIN, Math.min(REL_MAX, CHART_H - (ev.clientY - top))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  // One config per ACTIVE curve, in catalog order — the pane decides colour,
  // axis and style; `axisGroup` gives each curve its own scale, which is what
  // puts a coloured tick column per curve down the left.
  const configs = useMemo<SeriesConfig[]>(() => {
    const active = CATALOG.filter((c) => on.includes(c.key));
    const lines = active.map<SeriesConfig>((c) => ({
      id: c.key,
      column: c.column,
      label: c.label,
      color: colorOf(c.key, scheme),
      axis: 'L',
      axisGroup: c.key,
      style: 'line',
      visible: true,
      value: null,
      unit: c.unit,
      source: c.source,
      ...(c.derive ? { derive: c.derive } : {}),
    }));
    // An envelope is not a seventh curve: it takes its parent's `axisGroup`, so
    // it shares that curve's scale and adds no tick column — which is why a
    // band costs nothing against the cap.
    const envelopes = bands
      ? active
          .filter((c) => c.band)
          .map<SeriesConfig>((c) => {
            const spec = envelope(c.column);
            return {
              id: `${c.key}__band`,
              column: deriveId(spec),
              label: `${c.label} · mean ±1σ`,
              color: colorOf(c.key, scheme),
              axis: 'L',
              axisGroup: c.key,
              style: 'band',
              visible: true,
              value: null,
              unit: c.unit,
              source: c.source,
              derive: spec,
              // A `band` is TWO marks: the wash, and its MIDDLE drawn as an
              // ordinary line in the same ink. The middle of a Bollinger is an
              // SMA, so a banded curve gains a smoothed twin of itself — which
              // is worth having and must not compete, hence the hairline.
              lineWidth: 0.5,
            };
          })
      : [];
    // Envelopes LAST. `<Layers>` z-orders by declaration and the chart renders
    // `[...visible].reverse()`, so the row's FIRST config paints last = on top
    // (the controls list reads front→back, like a layers panel). Put the
    // envelopes first and the washes composite over every curve.
    return [...lines, ...envelopes];
  }, [bands, on, scheme]);

  // TWO ROWS when any relative is drawn. A relative is a different KIND of
  // reading from a level — it has a meaningful zero and a level does not — so
  // it gets its own row rather than a scale inside someone else's.
  const [levelConfigs, relConfigs] = useMemo(() => {
    const isRel = (c: SeriesConfig) =>
      CATALOG.find((e) => c.id.startsWith(e.key))?.group === 'relative';
    return [configs.filter((c) => !isRel(c)), configs.filter(isRel)];
  }, [configs]);
  const split = relConfigs.length > 0;

  // The fold runs the derived curves; the facts value the legend. A pane does
  // exactly what a terminal does here — it just never offers the menu.
  const prepared = useMemo(
    () =>
      prepareChart(
        { vol: { series: sources.vol! }, price: { series: sources.price! } },
        split
          ? [
              { id: LEVELS_ROW, configs: levelConfigs },
              { id: RELATIVES_ROW, configs: relConfigs },
            ]
          : [{ id: LEVELS_ROW, configs: levelConfigs }],
      ),
    [levelConfigs, relConfigs, split],
  );

  // Every axis in the relatives row runs +/-m about zero. That is what puts each
  // curve's zero on the SAME rule without pretending a log ratio and a
  // vol-point difference share a unit: symmetric axes agree on where zero is,
  // whatever their magnitudes. `centerOnZero` is the library's own rule,
  // including its all-zero guard.
  const axisOptions = useMemo(() => {
    const opts: Record<string, { min?: number; max?: number }> = {};
    for (const c of relConfigs) {
      const series = c.source ? prepared.sources[c.source] : undefined;
      const centred = centerOnZero(series ? extent(series, c.column) : null);
      if (centred) opts[configAxisId(RELATIVES_ROW, c)] = centred;
    }
    return opts;
  }, [prepared, relConfigs]);

  const rows: TimeSeriesChartRow[] = prepared.rows.map((r) => ({
    ...r,
    height: r.id === RELATIVES_ROW ? relH : split ? CHART_H - relH - 1 : CHART_H,
  }));

  const toggle = (key: string) =>
    setOn((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length < MAX_ACTIVE
          ? [...prev, key]
          : prev,
    );
  const full = on.length >= MAX_ACTIVE;

  return (
    <div style={S.root}>
      <div style={S.titleRow}>
        <SelectLabel>Symbol</SelectLabel>
        <span style={S.symbol}>AAPL</span>
        <h2 style={S.title}>ATM History</h2>
        <span style={S.spacer} />
        <PresetSlots active={1} />
        <span style={S.divider} />
        <SelectPill label="Ranges…" active={false} onClick={() => {}} />
      </div>

      <div style={S.controlRow}>
        <SelectorGroup label="Expiry" wrap>
          {EXPIRIES.map((e) => (
            <SelectPill key={e} label={e} active={e === expiry} onClick={() => setExpiry(e)} />
          ))}
        </SelectorGroup>
        <span style={S.spacer} />
        <ToggleGroup label="Day Range" items={DAY_RANGES} active={days} onChange={setDays} />
        <SelectPill label="Bands" active={bands} onClick={() => setBands((b) => !b)} />
      </div>

      <div style={S.seriesRow} role="group" aria-label="Curves">
        <SelectLabel>Display</SelectLabel>
        {CATALOG.filter((c) => c.group === 'level').map((c) => (
          <SeriesCheckbox
            key={c.key}
            label={c.label}
            color={colorOf(c.key, scheme)}
            checked={on.includes(c.key)}
            disabled={full && !on.includes(c.key)}
            onToggle={() => toggle(c.key)}
          />
        ))}
        <span style={S.divider} />
        <span style={S.groupLabel}>Relative</span>
        {CATALOG.filter((c) => c.group === 'relative').map((c) => (
          <SeriesCheckbox
            key={c.key}
            label={c.label}
            color={colorOf(c.key, scheme)}
            checked={on.includes(c.key)}
            disabled={full && !on.includes(c.key)}
            onToggle={() => toggle(c.key)}
          />
        ))}
        <span style={S.spacer} />
        <span style={full ? S.capFull : S.cap}>
          {on.length}/{MAX_ACTIVE} curves
        </span>
      </div>

      <div style={S.plotRow}>
        {/* The caption stays OUT of the well: it names what the chart is
            showing, so it belongs to the chrome, and keeping it out lets the
            well hold the rendering area and nothing else. */}
        <span style={S.subtitle}>
          {expiry} • {DAY_RANGES.find((d) => d.value === days)!.label}
        </span>
        <div style={S.plotWell} ref={wellRef}>
          <TimeSeriesChart
            rows={rows}
            sources={prepared.sources}
            axisOptions={axisOptions}
            theme={scheme === 'light' ? demoLight : demoDark}
            colorScheme={scheme}
          />
          {split ? (
            <div
              role="separator"
              aria-label="Resize the relatives row"
              aria-orientation="horizontal"
              style={{ ...S.rowGrip, top: CHART_H - relH - 5 }}
              onPointerDown={onGripDown}
            >
              <span aria-hidden style={S.rowGripBar} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof Pane> = {
  title: 'Chart/Consumer pane',
  component: Pane,
  parameters: { layout: 'fullscreen' },
  // A pane is a BOUNDED box inside a larger application, never the whole page —
  // and the chart needs a parent with a definite width to measure against.
  render: (_args, { globals }) => (
    <div style={{ display: 'flex', width: '100%', minWidth: 0, height: 540 }}>
      <Pane scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
    </div>
  ),
};
export default meta;

type Story = StoryObj<typeof Pane>;

/** The pane as a host ships it: four curves on, six allowed, the rest a click
 *  away — and the chart underneath told exactly what to draw. */
export const Default: Story = {};
