import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { defaultTheme } from '@pond-ts/charts';
import * as core from '@tidal-ts/core';
import { DEMO_INSTRUMENTS, deriveId, generatePriceSeries, shiftKeys } from '@tidal-ts/core';
import type { DeriveSpec } from '@tidal-ts/core';
import { drawnColumns, shiftDrawn, TimeSeriesChart, type ShiftCache } from './TimeSeriesChart.js';
import { foldSources } from './prepare.js';
import { bandColumns, type SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

// The chart's own import of `shiftKeys`, wrapped so a render can be asked what
// it was handed.
vi.mock('@tidal-ts/core', async (original) => {
  const actual = await original<typeof import('@tidal-ts/core')>();
  return { ...actual, shiftKeys: vi.fn(actual.shiftKeys) };
});

// A server render measures no width, and at width 0 the chart mounts no layer.
// Given one, every layer mounts — and each records what it was handed and what
// it reads, so a layer reading a column the narrowing dropped is caught here
// rather than as a pond `RangeError` in a host.
vi.mock('./useMeasuredWidth.js', async (original) => {
  const actual = await original<typeof import('./useMeasuredWidth.js')>();
  return { ...actual, useMeasuredWidth: () => [{ current: null }, 800] };
});
const mounted = vi.hoisted(() => [] as { layer: string; has: string[]; reads: string[] }[]);
vi.mock('@pond-ts/charts', async (original) => {
  const actual = await original<typeof import('@pond-ts/charts')>();
  type Props = { series: { schema: readonly { name: string }[] } } & Record<string, unknown>;
  const record =
    (layer: 'LineChart' | 'AreaChart' | 'BarChart' | 'BandChart', reads: (p: Props) => unknown[]) =>
    (p: Props) => {
      mounted.push({
        layer,
        has: p.series.schema.map((c) => c.name),
        reads: reads(p).map(String),
      });
      return (actual[layer] as unknown as (p: Props) => unknown)(p);
    };
  return {
    ...actual,
    LineChart: record('LineChart', (p) => [p.column]),
    AreaChart: record('AreaChart', (p) => [p.column]),
    BarChart: record('BarChart', (p) => [p.column]),
    BandChart: record('BandChart', (p) => [p.lower, p.upper]),
  };
});

const cfg = (over: Partial<SeriesConfig> & Pick<SeriesConfig, 'id' | 'column'>): SeriesConfig => ({
  label: over.id,
  color: 'blue',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  source: 'price',
  ...over,
});
const bb: DeriveSpec = { op: 'bollinger', inputs: ['close'], params: { period: 5 } };
const macd: DeriveSpec = { op: 'macd', inputs: ['close'] };
const band = cfg({ id: 'b', column: deriveId(bb), derive: bb, style: 'band' });
const lines = cfg({ id: 'm', column: deriveId(macd), derive: macd, style: 'lines' });
const price = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 60 }) as unknown as ChartSeries;
const other = generatePriceSeries(DEMO_INSTRUMENTS[1]!, { bars: 60 }) as unknown as ChartSeries;
const folded = foldSources({ price: { series: price }, other: { series: other } }, [band, lines]);
const names = (s: ChartSeries) => s.schema.map((c) => c.name);

describe('drawnColumns — what the end-shift has to copy', () => {
  it('is each drawn config’s own columns, per source, sorted and once each', () => {
    const drawn = drawnColumns(
      [
        cfg({ id: 'c', column: 'close' }),
        cfg({ id: 'c2', column: 'close', style: 'area' }),
        cfg({ id: 'o', column: 'open', source: 'other' }),
        band,
        lines,
      ],
      folded,
    );
    expect(drawn.get('price')).toEqual(
      [
        'close',
        ...Object.values(bandColumns(band.column)),
        ...core.opOutputs('macd').map((s) => `${lines.column}${s}`),
      ].sort(),
    );
    expect(drawn.get('other')).toEqual(['open']);
  });

  it('leaves out what does not draw', () => {
    const drawn = drawnColumns(
      [
        cfg({ id: 'hidden', column: 'open', visible: false }),
        cfg({
          id: 'leg',
          column: 'high',
          group: { id: 'g', hidden: true } as SeriesConfig['group'],
        }),
        cfg({ id: 'missing', column: 'sma(nothing){period:5}' }),
        cfg({ id: 'nowhere', column: 'close', source: 'absent' }),
        cfg({ id: 'c', column: 'close' }),
      ],
      folded,
    );
    expect([...drawn]).toEqual([['price', ['close']]]);
  });
});

describe('shiftDrawn — the end-shift on only what a layer reads', () => {
  const drawn = (m: Record<string, string[]>) => new Map(Object.entries(m));

  it('narrows each source to its drawn columns, then moves it one bar later', () => {
    const out = shiftDrawn(folded, drawn({ price: ['close'] }), new Map());
    const s = out.get('price')!;
    expect(names(s)).toEqual([names(price)[0], 'close']);
    // Same as shifting the whole source, for the column that is drawn.
    const whole = shiftKeys(price, 86_400_000);
    expect(Array.from(s.keyColumn().begin)).toEqual(Array.from(whole.keyColumn().begin));
    const close = (x: ChartSeries) => {
      const col = x.column('close' as never) as { read(i: number): unknown };
      return Array.from({ length: x.length }, (_, i) => col.read(i));
    };
    expect(close(s)).toEqual(close(price));
    expect(out.has('other')).toBe(false);
  });

  it('hands back the same series while its source and columns hold', () => {
    const cache: ShiftCache = new Map();
    const first = shiftDrawn(folded, drawn({ price: ['close'], other: ['open'] }), cache);
    // A new record around the same series (a host may rebuild it on every
    // settled view): nothing re-shifted.
    const again = shiftDrawn({ ...folded }, drawn({ price: ['close'], other: ['open'] }), cache);
    expect(again.get('price')).toBe(first.get('price'));
    expect(again.get('other')).toBe(first.get('other'));
    // One source's drawn columns change: only that source is shifted again.
    const toggled = shiftDrawn(folded, drawn({ price: ['close', 'open'], other: ['open'] }), cache);
    expect(toggled.get('price')).not.toBe(first.get('price'));
    expect(names(toggled.get('price')!)).toContain('open');
    expect(toggled.get('other')).toBe(first.get('other'));
    // A new series under the same key is shifted again.
    const refetched = shiftDrawn(
      { ...folded, other: generatePriceSeries(DEMO_INSTRUMENTS[1]!, { bars: 60 }) as never },
      drawn({ price: ['close', 'open'], other: ['open'] }),
      cache,
    );
    expect(refetched.get('other')).not.toBe(first.get('other'));
    expect(refetched.get('price')).toBe(toggled.get('price'));
  });

  it('forgets a source nothing draws any more', () => {
    const cache: ShiftCache = new Map();
    shiftDrawn(folded, drawn({ price: ['close'], other: ['open'] }), cache);
    shiftDrawn(folded, drawn({ price: ['close'] }), cache);
    expect([...cache.keys()]).toEqual(['price']);
  });
});

describe('the chart shifts only the columns its layers read', () => {
  it('hands shiftKeys each source narrowed to the drawn columns', () => {
    const spy = vi.mocked(core.shiftKeys);
    spy.mockClear();
    const configs = [
      cfg({ id: 'c', column: 'close' }),
      cfg({ id: 'a', column: 'open', style: 'area' }),
      band,
      lines,
      cfg({ id: 'o', column: 'high', source: 'other' }),
      cfg({ id: 'hidden', column: 'low', source: 'other', visible: false }),
    ];
    const html = renderToString(
      <TimeSeriesChart
        rows={[{ id: 'r', height: 200, configs }]}
        sources={folded}
        theme={defaultTheme}
      />,
    );
    expect(html).toBeTruthy();
    const handed = spy.mock.calls.map(([s]) =>
      names(s as ChartSeries)
        .slice(1)
        .sort(),
    );
    expect(handed).toContainEqual(drawnColumns(configs, folded).get('price'));
    expect(handed).toContainEqual(['high']);
    // Nothing was shifted whole.
    for (const cols of handed) {
      expect(cols.length).toBeLessThan(names(folded.price!).length - 1);
    }
  });
});

describe('every layer finds its column in the series it is handed', () => {
  // The narrowing is safe only while no layer reads a column outside
  // `drawnColumns`. Mount every layer kind that reads the shifted series, plus
  // the ones that do not (open line, bars), at daily and at one-minute grain.
  const render = (interval: '1d' | '1m') => {
    const p = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 400, interval });
    const o = generatePriceSeries(DEMO_INSTRUMENTS[1]!, { bars: 400, interval });
    const configs = [
      cfg({ id: 'pc', column: 'close' }), // OHLC close: the open line
      cfg({ id: 'pa', column: 'close', style: 'area' }),
      cfg({ id: 'po', column: 'open', style: 'area' }),
      band,
      lines,
      cfg({ id: 'oc', column: 'close', source: 'other', style: 'candle' }), // no OHLC: a line
      cfg({ id: 'oh', column: 'high', source: 'other' }),
      cfg({ id: 'ob', column: 'volume', source: 'other', style: 'bar' }),
      cfg({ id: 'hidden', column: 'low', source: 'other', visible: false }),
    ];
    const sources = foldSources(
      { price: { series: p as never }, other: { series: o as never } },
      configs,
    );
    mounted.length = 0;
    renderToString(
      <TimeSeriesChart
        rows={[{ id: 'r', height: 200, configs }]}
        sources={sources}
        ohlcSources={['price']}
        theme={defaultTheme}
      />,
    );
    return { sources, mounted: [...mounted] };
  };

  for (const interval of ['1d', '1m'] as const) {
    it(`at ${interval}`, () => {
      const { sources, mounted: layers } = render(interval);
      expect(layers.length).toBeGreaterThanOrEqual(10);
      for (const l of layers) {
        for (const col of l.reads) expect(l.has, `${l.layer} reads ${col}`).toContain(col);
      }
      // …and the narrowing really happened: the line on `other` drew from that
      // source's drawn columns only — not `open`, which nothing draws, nor
      // `low`, whose config is hidden.
      const high = layers.find((l) => l.reads[0] === 'high')!;
      expect(high.has.slice(1).sort()).toEqual(['close', 'high', 'volume']);
      expect(names(sources.other!)).toEqual(expect.arrayContaining(['open', 'low']));
    });
  }
});
