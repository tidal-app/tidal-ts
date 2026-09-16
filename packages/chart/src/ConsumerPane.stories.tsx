import { useMemo, useState } from 'react';
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
import { prepareChart, TimeSeriesChart } from './index.js';
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
 * - an expiry radio group and a day-range segmented control, which change what
 *   is asked for rather than what is drawn;
 * - colours, labels and units decided by the pane, so no `resolveColor` is
 *   passed at all and the chart never sees a design token.
 *
 * Two of the eight curves are **derived** (a ratio and a difference between two
 * columns), built as `DeriveSpec`s and folded by `prepareChart` — a pane gets
 * the study engine without shipping a study menu.
 *
 * Everything outside the plot is the pane's own (`.storybook/paneAtoms.tsx`)
 * and deliberately not part of the package: the library owns the drawing, the
 * host owns the chrome.
 */
const priceSeries = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 180 });
const volSeries = generateVolSeries('AAPL', { bars: 180 });
const sources = { vol: volSeries, price: priceSeries } as unknown as Record<string, ChartSeries>;

/** A categorical ladder the pane owns. A consumer's design system supplies
 *  these; the chart only ever sees the resolved colour on a config. */
const LADDER = [
  '#f0cb62',
  '#7caefd',
  '#79e295',
  '#fc8d82',
  '#73cdde',
  '#b99eef',
  '#ffa657',
  '#f986b8',
] as const;

const ratio: DeriveSpec = { op: 'ratio', inputs: ['iv21', 'iv63'] };
const spread: DeriveSpec = { op: 'diff', inputs: ['iv21', 'rvcc21'] };

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
}
const CATALOG: readonly Curve[] = [
  { key: 'iv21', label: 'ATM Vol 21D', column: 'iv21', source: 'vol', unit: '%', group: 'level' },
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
    label: '21D / 63D',
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
const colorOf = (key: string) => LADDER[CATALOG.findIndex((c) => c.key === key) % LADDER.length]!;

const MAX_ACTIVE = 6;
const DEFAULT_ON = ['iv21', 'hv21', 'rv21', 'price'];
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

  // One config per ACTIVE curve, in catalog order — the pane decides colour,
  // axis and style; `axisGroup` gives each curve its own scale, which is what
  // puts a coloured tick column per curve down the left.
  const configs = useMemo<SeriesConfig[]>(
    () =>
      CATALOG.filter((c) => on.includes(c.key)).map((c) => ({
        id: c.key,
        column: c.column,
        label: c.label,
        color: colorOf(c.key),
        axis: 'L',
        axisGroup: c.key,
        style: 'line',
        visible: true,
        value: null,
        unit: c.unit,
        source: c.source,
        ...(c.derive ? { derive: c.derive } : {}),
      })),
    [on],
  );

  // The fold runs the two derived curves; the facts value the legend. A pane
  // does exactly what a terminal does here — it just never offers the menu.
  const prepared = useMemo(
    () =>
      prepareChart({ vol: { series: sources.vol! }, price: { series: sources.price! } }, [
        { id: 'main', configs },
      ]),
    [configs],
  );
  const rows: TimeSeriesChartRow[] = prepared.rows.map((r) => ({ ...r, height: 400 }));

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
      </div>

      <div style={S.seriesRow} role="group" aria-label="Curves">
        <SelectLabel>Display</SelectLabel>
        {CATALOG.filter((c) => c.group === 'level').map((c) => (
          <SeriesCheckbox
            key={c.key}
            label={c.label}
            color={colorOf(c.key)}
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
            color={colorOf(c.key)}
            checked={on.includes(c.key)}
            disabled={full && !on.includes(c.key)}
            onToggle={() => toggle(c.key)}
          />
        ))}
        <span style={S.spacer} />
        <span style={S.cap}>
          {on.length}/{MAX_ACTIVE} curves
        </span>
      </div>

      <div style={S.plotRow}>
        <span style={S.subtitle}>
          {expiry} • {DAY_RANGES.find((d) => d.value === days)!.label}
        </span>
        <TimeSeriesChart
          rows={rows}
          sources={prepared.sources}
          theme={scheme === 'light' ? demoLight : demoDark}
          colorScheme={scheme}
        />
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
