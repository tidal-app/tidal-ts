import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { defaultTheme } from '@pond-ts/charts';
import { buildPriceSeries, columnExtent, type PriceRow } from '@tidal-ts/core';
import { TimeSeriesChart } from './TimeSeriesChart.js';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

// What is under test is the readback: every charts component is inert, the
// frame passes its children through, and `<BarChart>` records the series it is
// handed — so "reported" can be checked against "drawn".
const drawn: unknown[] = [];
vi.mock('@pond-ts/charts', async (importOriginal) => {
  const charts = await importOriginal<typeof import('@pond-ts/charts')>();
  const through = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const inert: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(charts))
    if (typeof value === 'function' && /^[A-Z]/.test(name)) inert[name] = () => null;
  const BarChart = ({ series }: { series: unknown }) => {
    drawn.push(series);
    return null;
  };
  return {
    ...charts,
    ...inert,
    ChartContainer: through,
    ChartRow: through,
    Layers: through,
    BarChart,
  };
});
// The measured width, settable per test — 0 is "not laid out yet".
const size = vi.hoisted(() => ({ width: 800 }));
vi.mock('./useMeasuredWidth.js', () => ({
  useMeasuredWidth: () => [{ current: null }, size.width],
}));

// Four trading weeks of daily bars, 100 shares a day, the close drifting up.
const DAY = 86_400_000;
const MONDAY = Date.UTC(2026, 0, 5);
const rows: PriceRow[] = [];
for (let w = 0; w < 4; w += 1)
  for (let d = 0; d < 5; d += 1) {
    const close = 10 + w * 5 + d;
    rows.push([MONDAY + (w * 7 + d) * DAY, close, close, close, close, 100]);
  }
const price = buildPriceSeries('price', rows) as unknown as ChartSeries;
// Stable, as a host's are: a new `sources` object is new data, and re-reports.
const sources = { price };

const bar = (id: string, column: string, extra: Partial<SeriesConfig> = {}): SeriesConfig => ({
  id,
  column,
  label: id,
  color: '#c9a94a',
  axis: 'L',
  style: 'bar',
  visible: true,
  value: null,
  source: 'price',
  window: '1w',
  ...extra,
});

const render = (
  configs: SeriesConfig[],
  onBarSeries: ((m: ReadonlyMap<string, ChartSeries>) => void) | undefined,
  ohlcSources?: readonly string[],
) => (
  <TimeSeriesChart
    rows={[{ id: 'r', height: 200, configs }]}
    sources={sources}
    ohlcSources={ohlcSources}
    theme={defaultTheme}
    onBarSeries={onBarSeries}
  />
);

describe('onBarSeries — the series a bar is drawn from', () => {
  it('reports the roll-up, which for volume is a sum the raw column never reaches', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    act(() => {
      create(render([bar('vol', 'volume'), bar('px', 'close')], (m) => seen.push(m)));
    });
    expect(seen).toHaveLength(1);
    const bars = seen[0]!;

    // The bug this exists for: an axis fit to the raw column (100) holding
    // weekly sums (500) clips every bar.
    expect(columnExtent(price as never, 'volume')).toEqual({ min: 100, max: 100 });
    expect(columnExtent(bars.get('vol') as never, 'volume')?.max).toBe(500);

    // `avg` lands inside the raw range: the last week averages 25..29 → 27.
    expect(columnExtent(bars.get('px') as never, 'close')?.max).toBe(27);
    expect(columnExtent(price as never, 'close')?.max).toBe(29);
  });

  it('leaves out a bar that draws nothing', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    act(() => {
      create(
        render(
          [bar('vol', 'volume'), bar('off', 'close', { visible: false }), bar('gone', 'nope')],
          (m) => seen.push(m),
        ),
      );
    });
    expect([...seen[0]!.keys()]).toEqual(['vol']);
  });

  it('does not fire again when only the callback identity changes', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    const configs = [bar('vol', 'volume')];
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(render(configs, (m) => seen.push(m)));
    });
    act(() => {
      r.update(render(configs, (m) => seen.push(m)));
    });
    expect(seen).toHaveLength(1);

    // …and does when the window does.
    act(() => {
      r.update(render([bar('vol', 'volume', { window: '1d' })], (m) => seen.push(m)));
    });
    expect(seen).toHaveLength(2);
    expect(columnExtent(seen[1]!.get('vol') as never, 'volume')?.max).toBe(100);
  });

  it('reports the very series the bar layer draws', () => {
    drawn.length = 0;
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    act(() => {
      create(render([bar('vol', 'volume', { colorMode: 'single' })], (m) => seen.push(m)));
    });
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn).toContain(seen[0]!.get('vol'));
  });

  it('does not loop on an inline ohlcSources array', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    const configs = [bar('vol', 'volume')];
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(render(configs, (m) => seen.push(m), ['price']));
    });
    act(() => {
      r.update(render(configs, (m) => seen.push(m), ['price']));
    });
    expect(seen).toHaveLength(1);
  });

  it('reports to a callback attached after mount', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    const configs = [bar('vol', 'volume')];
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(render(configs, undefined));
    });
    act(() => {
      r.update(render(configs, (m) => seen.push(m)));
    });
    expect(seen).toHaveLength(1);
  });

  it('holds the report until the width is measured', () => {
    const seen: ReadonlyMap<string, ChartSeries>[] = [];
    const configs = [bar('vol', 'volume')];
    let r!: ReturnType<typeof create>;
    size.width = 0;
    try {
      act(() => {
        r = create(render(configs, (m) => seen.push(m)));
      });
      expect(seen).toHaveLength(0);
    } finally {
      size.width = 800;
    }
    act(() => {
      r.update(render(configs, (m) => seen.push(m)));
    });
    expect(seen).toHaveLength(1);
  });
});
