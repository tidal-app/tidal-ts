import { defaultTheme, type ChartTheme } from '@pond-ts/charts';
import { DEMO_INSTRUMENTS, deriveId, generatePriceSeries, type DeriveSpec } from '@tidal-ts/core';
import {
  prepareChart,
  TimeSeriesChart,
  type ChartSeries,
  type SeriesConfig,
} from '@tidal-ts/chart';

// 1. Data: a pond TimeSeries of daily bars. Here a seeded practice walk; in an
//    app, your adapter turns your API's response into the same shape.
const price = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 200 }) as unknown as ChartSeries;

// 2. Studies are specs: an op, its inputs, its settings. `deriveId` names the
//    column the study's values land in.
const sma: DeriveSpec = { op: 'sma', inputs: ['close'], params: { period: 20 } };
const rsi: DeriveSpec = { op: 'rsi', inputs: ['close'], params: { period: 14 } };

// 3. Configs say what to draw, in which colour, on which axis. Colours here are
//    plain CSS; a host with a palette passes its own keys and a `resolveColor`.
const base = { axis: 'L', visible: true, value: null, unit: '', source: 'price' } as const;
const candles: SeriesConfig = {
  ...base,
  id: 'price',
  column: 'close',
  label: 'Price',
  color: '#8b93a8',
  style: 'candle',
  colorMode: 'split',
  riseColor: '#3fb68b',
  fallColor: '#e5534b',
};
const smaLine: SeriesConfig = {
  ...base,
  id: 'sma',
  column: deriveId(sma),
  derive: sma,
  label: 'SMA 20',
  color: '#f0a93f',
  style: 'line',
};
const rsiLine: SeriesConfig = {
  ...base,
  id: 'rsi',
  column: deriveId(rsi),
  derive: rsi,
  label: 'RSI 14',
  color: '#a99cf5',
  style: 'line',
};

// 4. The prepare step computes the studies and seats each config on its row.
const { rows, sources } = prepareChart({ price: { series: price } }, [
  { id: 'main', configs: [candles, smaLine] },
  { id: 'rsi', configs: [rsiLine] },
]);

// 5. The theme is a prop too: the chart reads no CSS and no provider.
const themeFor = (dark: boolean): ChartTheme => ({
  ...defaultTheme,
  background: undefined,
  axis: {
    ...defaultTheme.axis,
    label: dark ? '#868fa6' : '#55607a',
    grid: dark ? 'rgba(233,237,246,0.08)' : 'rgba(17,24,39,0.10)',
  },
});

export default function FirstChart({ dark = true }: { dark?: boolean }) {
  return (
    <TimeSeriesChart
      rows={rows.map((r) => ({ ...r, height: r.id === 'main' ? 280 : 140 }))}
      sources={sources}
      ohlcSources={['price']}
      theme={themeFor(dark)}
      colorScheme={dark ? 'dark' : 'light'}
    />
  );
}
