import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { buildPriceSeries, deriveId, type DeriveSpec, type PriceRow } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

// What is under test is the THEME the frame is handed across a live edit: every
// charts component is inert and the frame records its `theme` prop.
const themes: { line: Record<string, unknown>; bar: Record<string, unknown> }[] = [];
vi.mock('@pond-ts/charts', async (importOriginal) => {
  const charts = await importOriginal<typeof import('@pond-ts/charts')>();
  const inert: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(charts))
    if (typeof value === 'function' && /^[A-Z]/.test(name)) inert[name] = () => null;
  const through = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const ChartContainer = ({ theme, children }: { theme: never; children?: ReactNode }) => {
    themes.push(theme);
    return <>{children}</>;
  };
  return { ...charts, ...inert, ChartContainer, ChartRow: through, Layers: through };
});
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');
const { prepareChart, outputKey } = await import('./index.js');

const DAY = 86_400_000;
const rows: PriceRow[] = [];
for (let d = 0; d < 60; d += 1) {
  const v = 100 + Math.sin(d / 4) * 5;
  rows.push([Date.UTC(2026, 0, 1) + d * DAY, v, v + 1, v - 1, v, 1000]);
}
const price = buildPriceSeries('X', rows) as unknown as ChartSeries;
const spec: DeriveSpec = { op: 'macd', inputs: ['close'] };
const macd: SeriesConfig = {
  id: 's',
  column: deriveId(spec),
  label: 'MACD',
  color: '#4f9cd9',
  axis: 'L',
  style: 'lines',
  visible: true,
  value: null,
  source: 'price',
  derive: spec,
};
const prepared = prepareChart({ price: { series: price } }, [{ id: 'r', configs: [macd] }]);
const sources = prepared.sources;
const chart = (c: SeriesConfig) => (
  <TimeSeriesChart
    rows={[{ id: 'r', height: 200, configs: [{ ...prepared.rows[0]!.configs[0]!, ...c }] }]}
    sources={sources}
    theme={defaultTheme}
  />
);

describe('outputBars moves an output’s ink between the line and bar themes', () => {
  it('rebuilds the theme when only outputBars changes, both ways', () => {
    const hist = outputKey('s', 2);
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(chart(macd));
    });
    expect(themes.at(-1)!.bar[hist]).toBeDefined();
    expect(themes.at(-1)!.line[hist]).toBeUndefined();

    act(() => r.update(chart({ ...macd, outputBars: false })));
    expect(themes.at(-1)!.line[hist]).toMatchObject({ color: '#4f9cd9' });

    act(() => r.update(chart(macd)));
    expect(themes.at(-1)!.bar[hist]).toMatchObject({ fill: '#4f9cd9' });
  });
});
