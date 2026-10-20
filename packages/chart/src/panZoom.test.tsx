import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { buildPriceSeries, type PriceRow } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

const containers: Record<string, unknown>[] = [];
vi.mock('@pond-ts/charts', async (importOriginal) => {
  const charts = await importOriginal<typeof import('@pond-ts/charts')>();
  const through = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const inert: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(charts))
    if (typeof value === 'function' && /^[A-Z]/.test(name)) inert[name] = () => null;
  return {
    ...charts,
    ...inert,
    ChartContainer: (props: Record<string, unknown> & { children?: ReactNode }) => {
      containers.push(props);
      return <>{props.children}</>;
    },
    ChartRow: through,
    Layers: through,
  };
});
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');
const { prepareChart } = await import('./index.js');

function price(): ChartSeries {
  const rows: PriceRow[] = [];
  const open = Date.UTC(2026, 6, 14, 13, 30);
  for (let m = 0; m < 30; m += 1) rows.push([open + m * 60_000, 300, 301, 299, 300, 1000]);
  return buildPriceSeries('X', rows) as unknown as ChartSeries;
}

const config: SeriesConfig = {
  id: 's',
  column: 'close',
  label: 's',
  color: '#c9a94a',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  source: 'price',
};

const panZoomOf = (panZoom?: 'none' | 'pan') => {
  const prepared = prepareChart({ price: { series: price() } }, [{ id: 'r', configs: [config] }]);
  renderToString(
    <TimeSeriesChart
      rows={[{ id: 'r', height: 200, configs: prepared.rows[0]!.configs }]}
      sources={prepared.sources}
      theme={defaultTheme}
      {...(panZoom ? { panZoom } : {})}
    />,
  );
  return containers.at(-1)!.panZoom;
};

beforeEach(() => {
  containers.length = 0;
});

describe('the plot’s pan/zoom gesture', () => {
  it('stays on when the host says nothing', () => {
    expect(panZoomOf()).toBe(true);
  });

  it('is the host’s to turn off, so a wheel can scroll a container around the chart', () => {
    expect(panZoomOf('none')).toBe('none');
    expect(panZoomOf('pan')).toBe('pan');
  });
});
