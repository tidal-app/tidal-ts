import type { Meta, StoryObj } from '@storybook/react';
import {
  buildPriceSeries,
  DEMO_INSTRUMENTS,
  deriveId,
  generatePriceSeries,
  generateVolSeries,
  type DeriveSpec,
  type PriceRow,
} from '@tidal-ts/core';
import { demoDark, demoLight } from '../.storybook/demoTheme.js';
import {
  prepareChart,
  TimeSeriesChart,
  type TimeSeriesChartProps,
  type TimeSeriesChartRow,
} from './index.js';
import type { ChartSeries, SeriesConfig } from './index.js';

/**
 * The chart's workshop, hosted the way a CONSUMER hosts it: a literal
 * `ChartTheme`, colours written into the configs, and no provider of any kind.
 * Tidal drives the same component from its `--td-*` tokens; if these stories
 * ever need a provider to render, the package has grown a dependency on its
 * host.
 *
 * The data is `@tidal-ts/core`'s deterministic fixtures — a seeded walk, so the
 * same story always draws the same picture.
 */
const volSeries = generateVolSeries('AAPL', { bars: 180 });
const priceSeries = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 180 });

// Keyed data sources — a config selects its series by `source`. Specific schemas
// erase to `ChartSeries` (heterogeneous rows work in the base schema).
const sources = { vol: volSeries, price: priceSeries } as unknown as Record<string, ChartSeries>;

/** A config's `color` is whatever the host's `resolveColor` understands. These
 *  are CSS colours, so no resolver is passed at all — the default is identity,
 *  which is the simplest thing a consumer can do. */
const line = (
  id: string,
  column: string,
  label: string,
  color: string,
  over: Partial<SeriesConfig> = {},
): SeriesConfig => ({
  id,
  column,
  label,
  color,
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  unit: '%',
  source: 'vol',
  ...over,
});

const volConfigs: SeriesConfig[] = [
  line('iv21', 'iv21', 'ATM Vol 21D', '#4f9cd9'),
  line('hv21', 'hv21', 'ATM Vol 21D · Historical eMove', '#8b5cf6'),
  line('iv63', 'iv63', 'ATM Vol 63D', '#e0518a'),
  line('iv252', 'iv252', 'ATM Vol 252D', '#c9a06a'),
];
const priceConfigs: SeriesConfig[] = [
  line('price', 'close', 'Price', '#c9a94a', { axis: 'R', unit: '', source: 'price' }),
];

const rows: TimeSeriesChartRow[] = [
  { id: 'top', height: 300, configs: volConfigs },
  { id: 'bottom', height: 150, configs: priceConfigs },
];

/** The host's job, in four lines: pick a theme, say which way a hovered axis
 *  lifts, hand both to the chart. */
function Hosted({ scheme, ...args }: TimeSeriesChartProps & { scheme: 'dark' | 'light' }) {
  return (
    <TimeSeriesChart
      {...args}
      theme={scheme === 'light' ? demoLight : demoDark}
      colorScheme={scheme}
    />
  );
}

const meta: Meta<typeof TimeSeriesChart> = {
  title: 'Chart/TimeSeriesChart',
  component: TimeSeriesChart,
  parameters: { layout: 'fullscreen' },
  args: { rows, sources, ohlcSources: ['price'] },
  render: (args, { globals }) => (
    <Hosted {...args} scheme={globals.scheme === 'light' ? 'light' : 'dark'} />
  ),
};
export default meta;

type Story = StoryObj<typeof TimeSeriesChart>;

/** Two rows on one time axis: the ATM term structure over the price. */
export const Default: Story = {};

/** `dimmed` fades everything that is not the reading you are following — the
 *  emphasis a legend hover or a selection drives in a host. */
export const Emphasis: Story = { args: { dimmed: ['hv21', 'iv63'] } };

/** One row, one series: the smallest useful chart, and the shape a simple
 *  consumer pane starts from. */
export const Single: Story = {
  args: { rows: [{ id: 'only', height: 380, configs: [volConfigs[0]!] }] },
};

/** Two cash sessions of one-minute bars, back to back: 390 bars to the close,
 *  an overnight gap, 390 more from the next open. The fixture generates one
 *  contiguous run, so the second day is a second run seeded off the first
 *  day's close and stitched on. */
const SESSION_BARS = 390;
const DAY_MS = 24 * 60 * 60_000;
// 2024-01-02 21:00Z — a 16:00 ET close — and the same time the next day.
const DAY_ONE_CLOSE_MS = 1_704_229_200_000;
const intradaySeries = (() => {
  const inst = DEMO_INSTRUMENTS[0]!;
  const rowsOf = (s: ReturnType<typeof generatePriceSeries>): PriceRow[] => {
    type Col = { at(i: number): number | undefined };
    const t = s.keyColumn() as unknown as Col;
    const [o, h, l, c, v] = (['open', 'high', 'low', 'close', 'volume'] as const).map(
      (n) => s.column(n) as unknown as Col,
    );
    return Array.from({ length: s.length }, (_, i) => [
      t.at(i)!,
      o!.at(i)!,
      h!.at(i)!,
      l!.at(i)!,
      c!.at(i)!,
      v!.at(i)!,
    ]);
  };
  // The fixture's defaults are DAILY moves; a minute bar walks a few basis
  // points, not two percent, or the day is a cliff.
  const minute = { bars: SESSION_BARS, interval: '1m', volatility: 0.0006, drift: 0 } as const;
  const one = rowsOf(generatePriceSeries(inst, { ...minute, endMs: DAY_ONE_CLOSE_MS }));
  const two = rowsOf(
    generatePriceSeries(inst, {
      ...minute,
      endMs: DAY_ONE_CLOSE_MS + DAY_MS,
      startPrice: one[one.length - 1]![4],
      seed: 7,
    }),
  );
  return buildPriceSeries(inst.symbol, [...one, ...two]);
})();

/** The same envelope the consumer pane draws: a 20-bar Bollinger at 1σ, folded
 *  by `prepareChart` so the band's three columns exist on the series. */
const intradayEnvelope: DeriveSpec = {
  op: 'bollinger',
  inputs: ['close'],
  params: { period: 20, stdDev: 1 },
};
const intradayConfigs: SeriesConfig[] = [
  line('close', 'close', 'Price', '#c9a94a', { unit: '', source: 'price' }),
  line('close__band', deriveId(intradayEnvelope), 'Price · mean ±1σ', '#c9a94a', {
    style: 'band',
    unit: '',
    source: 'price',
    derive: intradayEnvelope,
    lineWidth: 0.5,
  }),
];
const intraday = prepareChart({ price: { series: intradaySeries as unknown as ChartSeries } }, [
  { id: 'only', configs: intradayConfigs },
]);

/** A band across a session seam. Every other band here is daily; this is the
 *  intraday case, where the seam is a real gap in the data. With
 *  `collapseWeekends` on (the default here) the axis closes the overnight and
 *  the wash ends at the close and restarts at the open, exactly as its centre
 *  line does — pond's own `sessionBreaks`, since charts 0.70.0. Turn
 *  `collapseWeekends` off in the controls and the gap comes back on a
 *  continuous axis; the wash and the line then both bridge it. */
export const IntradayBand: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: intraday.rows[0]!.configs }],
    sources: intraday.sources,
    ohlcSources: [],
    collapseWeekends: true,
  },
};
