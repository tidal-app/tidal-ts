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

/** The close as an area across the same seam. One `<AreaChart sessionBreaks>`
 *  (charts 0.73): the fill ends on the day's last close and restarts at the
 *  next open, and it rests on the plot's floor without widening the axis to
 *  zero. The price source carries OHLC, so the fill starts at the open print. */
export const IntradayArea: Story = {
  args: {
    rows: [
      {
        id: 'only',
        height: 380,
        configs: [
          line('close', 'close', 'Price', '#c9a94a', {
            unit: '',
            source: 'price',
            style: 'area',
          }),
        ],
      },
    ],
    sources: intraday.sources,
    ohlcSources: ['price'],
    collapseWeekends: true,
  },
};

/** A line's own texture and opacity — `lineDash` and `opacity`, both
 *  overrides of what the series' category would draw. Solid, dashed and dotted
 *  term-structure lines, the last at half opacity. */
export const LineTextures: Story = {
  args: {
    rows: [
      {
        id: 'only',
        height: 380,
        configs: [
          volConfigs[0]!,
          { ...volConfigs[2]!, lineDash: 'dashed' },
          { ...volConfigs[3]!, lineDash: 'dotted', opacity: 0.5 },
        ],
      },
    ],
  },
};

/** A MACD's three outputs, one of them given its own ink: by default a
 *  multi-output study is ONE colour with a texture per output; `outputStyles`
 *  overrides any output by name, here the `Signal` line in a second colour. */
const macdSpec: DeriveSpec = { op: 'macd', inputs: ['close'] };
const macdConfigs: SeriesConfig[] = [
  line('macd', deriveId(macdSpec), 'Price · MACD', '#4f9cd9', {
    style: 'lines',
    unit: '',
    source: 'price',
    derive: macdSpec,
    outputStyles: { Signal: { color: '#e0518a', lineDash: 'solid' } },
  }),
];
const macd = prepareChart({ price: { series: priceSeries as unknown as ChartSeries } }, [
  { id: 'only', configs: macdConfigs },
]);
export const PerOutputInk: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: macd.rows[0]!.configs }],
    sources: macd.sources,
    ohlcSources: [],
  },
};

/** A MACD with every output a line — `outputBars: false` draws its histogram
 *  as a third (dotted) line instead of bars. */
const macdLines = prepareChart({ price: { series: priceSeries as unknown as ChartSeries } }, [
  {
    id: 'only',
    configs: [
      line('macd', deriveId(macdSpec), 'Price · MACD', '#4f9cd9', {
        style: 'lines',
        unit: '',
        source: 'price',
        derive: macdSpec,
        outputBars: false,
      }),
    ],
  },
]);
export const MacdAllLines: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: macdLines.rows[0]!.configs }],
    sources: macdLines.sources,
    ohlcSources: [],
  },
};

/** One SMA run on a band's two edges (`fan: ['Upper', 'Lower']`) draws a band
 *  of its own: the smoothed edges, washed between, with no centre line — over
 *  the band it smooths, which keeps its own. */
const fanBand: DeriveSpec = {
  op: 'bollinger',
  inputs: ['close'],
  params: { period: 20, stdDev: 2 },
};
const fanSma: DeriveSpec = {
  op: 'sma',
  inputs: [{ from: fanBand, output: 'Upper' }],
  params: { period: 10 },
};
const fanConfigs: SeriesConfig[] = [
  line('price', 'close', 'Price', '#c9a94a', { unit: '', source: 'price' }),
  line('band', deriveId(fanBand), 'Price · BOLLINGER(20, 2)', '#4f9cd9', {
    style: 'band',
    unit: '',
    source: 'price',
    derive: fanBand,
  }),
  line('smooth', deriveId(fanSma), 'Price · BOLLINGER(20, 2) · Upper, Lower · SMA(10)', '#e0518a', {
    style: 'band',
    unit: '',
    source: 'price',
    derive: fanSma,
    fan: ['Upper', 'Lower'],
  }),
];
const fan = prepareChart({ price: { series: priceSeries as unknown as ChartSeries } }, [
  { id: 'only', configs: fanConfigs },
]);
export const FannedBand: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: fan.rows[0]!.configs }],
    sources: fan.sources,
    ohlcSources: [],
  },
};

/** A DATA node drawing two of its bar's columns: the price's open and close as
 *  a band between them (`fan` on a raw config, `style: 'band'`), and as two
 *  lines. The band's edges cross wherever a bar closes below its open. */
const openClose = (style: 'band' | 'lines'): SeriesConfig =>
  line('oc', 'open', 'Price · Open, Close', '#c9a94a', {
    unit: '',
    source: 'price',
    style,
    fan: ['open', 'close'],
  });
export const PriceOpenCloseBand: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: [openClose('band')] }],
    sources: { price: priceSeries as unknown as ChartSeries },
    ohlcSources: [],
  },
};
export const PriceOpenCloseLines: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: [openClose('lines')] }],
    sources: { price: priceSeries as unknown as ChartSeries },
    ohlcSources: [],
  },
};

/** A Bollinger drawn as just its band — `bandMiddle: false` drops the centre. */
const bandOnlySpec: DeriveSpec = { op: 'bollinger', inputs: ['close'], params: { period: 20 } };
const bandOnly = prepareChart({ price: { series: priceSeries as unknown as ChartSeries } }, [
  {
    id: 'only',
    configs: [
      line('close', 'close', 'Price', '#c9a94a', { unit: '', source: 'price' }),
      line('bb', deriveId(bandOnlySpec), 'Price · BOLLINGER(20, 2)', '#4f9cd9', {
        style: 'band',
        unit: '',
        source: 'price',
        derive: bandOnlySpec,
        bandMiddle: false,
      }),
    ],
  },
]);
export const BandWithoutMiddle: Story = {
  args: {
    rows: [{ id: 'only', height: 380, configs: bandOnly.rows[0]!.configs }],
    sources: bandOnly.sources,
    ohlcSources: [],
  },
};
