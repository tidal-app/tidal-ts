import type { Meta, StoryObj } from '@storybook/react';
import { DEMO_INSTRUMENTS, generatePriceSeries, generateVolSeries } from '@tidal-ts/core';
import { demoDark, demoLight } from '../.storybook/demoTheme.js';
import { TimeSeriesChart, type TimeSeriesChartProps, type TimeSeriesChartRow } from './index.js';
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
