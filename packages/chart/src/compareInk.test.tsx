import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { buildPriceSeries, deriveId, type DeriveSpec, type PriceRow } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

// What is under test is the THEME the frame is handed: every charts component
// is inert, the frame records its `theme`, and the axes record their colour.
type Theme = { line: Record<string, { color: string }>; area: Record<string, { fill: string }> };
const themes: Theme[] = [];
const axisColors: (string | undefined)[] = [];
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
  const YAxis = ({ color }: { color?: string }) => {
    axisColors.push(color);
    return null;
  };
  return { ...charts, ...inert, ChartContainer, YAxis, ChartRow: through, Layers: through };
});
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');
const { prepareChart, isCompareSide, outputKey } = await import('./index.js');

const DAY = 86_400_000;
const rows: PriceRow[] = [];
for (let d = 0; d < 40; d += 1) {
  const v = 100 + Math.sin(d / 4) * 5;
  rows.push([Date.UTC(2026, 0, 1) + d * DAY, v, v + 1, v - 1, v, 1000]);
}
const price = buildPriceSeries('X', rows) as unknown as ChartSeries;
const other = buildPriceSeries('Y', rows) as unknown as ChartSeries;

const cfg = (id: string, column: string, extra: Partial<SeriesConfig> = {}): SeriesConfig => ({
  id,
  column,
  label: id,
  color: '#c53d26',
  axis: 'R',
  style: 'line',
  visible: true,
  value: null,
  source: 'price',
  ...extra,
});

describe('isCompareSide', () => {
  it('is the side whose every leaf is on the comparison symbol', () => {
    expect(isCompareSide({ column: 'cmp_close' })).toBe(true);
    expect(isCompareSide({ column: 'close' })).toBe(false);
    const studyOnLeg: DeriveSpec = { op: 'sma', inputs: ['cmp_close'], params: { period: 5 } };
    expect(isCompareSide({ column: deriveId(studyOnLeg), derive: studyOnLeg })).toBe(true);
    // A joined pair reads BOTH symbols: it is the answer, not the before.
    const joined: DeriveSpec = { op: 'ratio', inputs: ['close', 'cmp_close'] };
    expect(isCompareSide({ column: deriveId(joined), derive: joined })).toBe(false);
    // Safe on a malformed persisted spec, as `usesCompare` is.
    const broken = { op: 'sma', inputs: [null] } as unknown as DeriveSpec;
    expect(isCompareSide({ column: 'x', derive: broken })).toBe(false);
  });
});

describe('compareInk', () => {
  const primary = cfg('p', 'close', { style: 'area' });
  const mirror = cfg('p__auto', 'cmp_close', { style: 'area' });
  const prepared = prepareChart({ price: { series: price, compare: other } }, [
    { id: 'r', configs: [primary, mirror] },
  ]);
  const render = (ink?: string) => {
    act(() => {
      create(
        <TimeSeriesChart
          rows={[{ id: 'r', height: 200, configs: prepared.rows[0]!.configs }]}
          sources={prepared.sources}
          theme={defaultTheme}
          compareInk={ink}
        />,
      );
    });
    return themes.at(-1)!;
  };

  it('draws the compared side in the before ink and the reference in its own', () => {
    const t = render('#8c8882');
    expect(t.line['p']!.color).toBe('#c53d26');
    expect(t.area['p']!.fill).toBe('#c53d26');
    expect(t.line['p__auto']!.color).toBe('#8c8882');
    expect(t.area['p__auto']!.fill).toBe('#8c8882');
  });

  it('keeps the shared axis in the series colour (the configs still agree)', () => {
    axisColors.length = 0;
    render('#8c8882');
    expect(axisColors).toContain('#c53d26');
  });

  it('changes nothing when absent', () => {
    const t = render(undefined);
    expect(t.line['p__auto']!.color).toBe('#c53d26');
  });

  it('inks a study on the compared leg, outputs and all', () => {
    const spec: DeriveSpec = { op: 'macd', inputs: ['cmp_close'] };
    const study = cfg('m', deriveId(spec), { style: 'lines', derive: spec, axis: 'L' });
    const p = prepareChart({ price: { series: price, compare: other } }, [
      { id: 'r', configs: [study] },
    ]);
    act(() => {
      create(
        <TimeSeriesChart
          rows={[{ id: 'r', height: 200, configs: p.rows[0]!.configs }]}
          sources={p.sources}
          theme={defaultTheme}
          compareInk="#8c8882"
        />,
      );
    });
    const t = themes.at(-1)!;
    expect(t.line[outputKey('m', 0)]!.color).toBe('#8c8882');
  });

  it('follows a study re-pointed at the other symbol under the same id', () => {
    const on = (input: string): SeriesConfig => {
      const spec: DeriveSpec = { op: 'sma', inputs: [input], params: { period: 5 } };
      // A fixed width, so only the SIDE moves in the signature.
      return cfg('s', deriveId(spec), { derive: spec, axis: 'L', lineWidth: 1 });
    };
    const p = prepareChart({ price: { series: price, compare: other } }, [
      { id: 'r', configs: [on('close'), { ...on('cmp_close'), id: 'other' }] },
    ]);
    const el = (c: SeriesConfig) => (
      <TimeSeriesChart
        rows={[{ id: 'r', height: 200, configs: [c] }]}
        sources={p.sources}
        theme={defaultTheme}
        compareInk="#8c8882"
      />
    );
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(el(on('close')));
    });
    expect(themes.at(-1)!.line['s']!.color).toBe('#c53d26');
    act(() => r.update(el(on('cmp_close'))));
    expect(themes.at(-1)!.line['s']!.color).toBe('#8c8882');
  });
});
