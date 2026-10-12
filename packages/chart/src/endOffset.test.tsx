import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { buildPriceSeries, type PriceRow } from '@tidal-ts/core';
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
  };
});

// …and the chart mounts its container only once it has a width.
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');

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

const render = (c: SeriesConfig, price: ChartSeries) =>
  renderToString(
    <TimeSeriesChart
      rows={[{ id: 'r', height: 200, configs: [c] }]}
      sources={{ price }}
      ohlcSources={['price']}
      theme={defaultTheme}
    />,
  );

beforeEach(() => {
  seen.length = 0;
});

describe('a close is drawn at its bar’s end by the layer, not by a copy', () => {
  it('a vol-style line takes the source series and an offset of one bar', () => {
    const price = intraday();
    render(config('line', 'high'), price);
    const line = seen.find((s) => s.layer === 'LineChart');
    expect(line?.props.series).toBe(price);
    expect(line?.props.xOffset).toBe(MIN);
    expect(line?.props.sessionBreaks).toBe(true);
  });

  it('the price close starts at the open, a series already in drawn time', () => {
    const price = intraday();
    render(config('line'), price);
    const line = seen.find((s) => s.layer === 'LineChart');
    expect(line?.props.series).not.toBe(price);
    expect(line?.props.xOffset).toBeUndefined();
  });

  it('an area is ONE layer that breaks at the seam, with no baseline of its own', () => {
    const price = intraday();
    render(config('area', 'high'), price);
    const areas = seen.filter((s) => s.layer === 'AreaChart');
    expect(areas).toHaveLength(1);
    expect(areas[0]!.props.series).toBe(price);
    expect(areas[0]!.props.xOffset).toBe(MIN);
    expect(areas[0]!.props.sessionBreaks).toBe(true);
    expect(areas[0]!.props.baseline).toBeUndefined();
  });
});
