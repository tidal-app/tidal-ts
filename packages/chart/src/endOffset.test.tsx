import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { buildPriceSeries, deriveId, type DeriveSpec, type PriceRow } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

// Record what each line-ish layer is handed, rather than what it draws: the
// draw needs a canvas, and what this pins is the contract with charts — the
// layer gets the RAW series and moves it itself (`xOffset`), and a fill breaks
// at the seams on its own (`sessionBreaks`).
const seen: { layer: string; props: Record<string, unknown> }[] = [];
vi.mock('@pond-ts/charts', async (importOriginal) => {
  const charts = await importOriginal<typeof import('@pond-ts/charts')>();
  const spy = (layer: string) => (props: Record<string, unknown>) => {
    seen.push({ layer, props });
    return null;
  };
  // A server render never lays the frame out, so the frame passes its children
  // straight through and every other component (axes, cursor) draws nothing —
  // only the layers' props are under test.
  const through = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const inert: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(charts))
    if (typeof value === 'function' && /^[A-Z]/.test(name)) inert[name] = () => null;
  return {
    ...charts,
    ...inert,
    ChartContainer: through,
    ChartRow: through,
    Layers: through,
    LineChart: spy('LineChart'),
    AreaChart: spy('AreaChart'),
    BandChart: spy('BandChart'),
    BarChart: spy('BarChart'),
  };
});

// …and the chart mounts its container only once it has a width.
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');
const { prepareChart } = await import('./index.js');

const MIN = 60_000;
/** Two one-minute sessions a day apart — intraday, so the axis has a seam. */
function intraday(): ChartSeries {
  const rows: PriceRow[] = [];
  for (const day of [14, 15]) {
    const open = Date.UTC(2026, 6, day, 13, 30);
    for (let m = 0; m < 30; m += 1) {
      const v = 300 + m * 0.01;
      rows.push([open + m * MIN, v, v + 0.5, v - 0.5, v + 0.2, 1000]);
    }
  }
  return buildPriceSeries('X', rows) as unknown as ChartSeries;
}

const config = (style: SeriesConfig['style'], column = 'close'): SeriesConfig => ({
  id: 's',
  column,
  label: 's',
  color: '#c9a94a',
  axis: 'L',
  style,
  visible: true,
  value: null,
  source: 'price',
});

const render = (c: SeriesConfig, price: ChartSeries) => {
  // A study's columns exist only once the prepare step has folded them in.
  const prepared = prepareChart({ price: { series: price } }, [{ id: 'r', configs: [c] }]);
  renderToString(
    <TimeSeriesChart
      rows={[{ id: 'r', height: 200, configs: prepared.rows[0]!.configs }]}
      sources={prepared.sources}
      ohlcSources={['price']}
      theme={defaultTheme}
    />,
  );
  return prepared.sources.price!;
};
const layers = (name: string) => seen.filter((s) => s.layer === name).map((s) => s.props);
const study = (style: SeriesConfig['style'], spec: DeriveSpec): SeriesConfig => ({
  ...config(style, deriveId(spec)),
  derive: spec,
});

beforeEach(() => {
  seen.length = 0;
});

describe('a close is drawn at its bar’s end by the layer, not by a copy', () => {
  it('a non-price line takes the source series and an offset of one bar', () => {
    const src = render(config('line', 'high'), intraday());
    const [line] = layers('LineChart');
    expect(line).toBeDefined();
    expect(line!.series).toBe(src);
    expect(line!.xOffset).toBe(MIN);
    expect(line!.sessionBreaks).toBe(true);
  });

  it('the price close starts at the open — its own series, already in drawn time', () => {
    const src = render(config('line'), intraday());
    const [line] = layers('LineChart');
    expect(line).toBeDefined();
    // The open-line: one open print per session, then every close.
    expect((line!.series as ChartSeries).length).toBe(src.length + 2);
    expect(line!.xOffset).toBeUndefined();
  });

  it('an area is ONE layer that breaks at the seam, with no baseline of its own', () => {
    const src = render(config('area', 'high'), intraday());
    const areas = layers('AreaChart');
    expect(areas).toHaveLength(1);
    expect(areas[0]!.series).toBe(src);
    expect(areas[0]!.xOffset).toBe(MIN);
    expect(areas[0]!.sessionBreaks).toBe(true);
    expect(areas[0]!.baseline).toBeUndefined();
  });

  it('an area of the price close takes the open-line, unshifted', () => {
    const src = render(config('area'), intraday());
    const [area] = layers('AreaChart');
    expect(area).toBeDefined();
    expect((area!.series as ChartSeries).length).toBe(src.length + 2);
    expect(area!.xOffset).toBeUndefined();
    expect(area!.sessionBreaks).toBe(true);
  });

  it('a band’s wash and centre both take the source and the one-bar offset', () => {
    const src = render(
      study('band', { op: 'bollinger', inputs: ['close'], params: { period: 5, stdDev: 1 } }),
      intraday(),
    );
    const [wash] = layers('BandChart');
    const [centre] = layers('LineChart');
    for (const l of [wash, centre]) {
      expect(l).toBeDefined();
      expect(l!.series).toBe(src);
      expect(l!.xOffset).toBe(MIN);
      expect(l!.sessionBreaks).toBe(true);
    }
  });

  it('a histogram has no xOffset, so it draws from a copy moved by exactly one bar', () => {
    const src = render(study('lines', { op: 'macd', inputs: ['close'] }), intraday());
    const lines = layers('LineChart');
    const [hist] = layers('BarChart');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.series).toBe(src);
      expect(l.xOffset).toBe(MIN);
    }
    expect(hist).toBeDefined();
    expect(hist!.xOffset).toBeUndefined();
    const moved = hist!.series as ChartSeries;
    expect(moved).not.toBe(src);
    const key = (s: ChartSeries, i: number) =>
      (s.keyColumn() as unknown as { at(i: number): number }).at(i);
    expect(moved.length).toBe(src.length);
    expect(key(moved, 0)).toBe(key(src, 0) + MIN);
    expect(key(moved, src.length - 1)).toBe(key(src, src.length - 1) + MIN);
  });
});
