import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { buildPriceSeries, type PriceRow } from '@tidal-ts/core';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';
import type { ChartLevel } from './levels.js';
import type { TimeSeriesChartProps } from './TimeSeriesChart.js';

// The marks under test are charts' `<Baseline>` / `<Zone>`: every charts
// component is inert, these two record their props, the frame its theme and
// each axis its props (to show a level never moves one).
type Roles = Record<string, { color: string; dash?: number[]; fillOpacity?: number }>;
const themes: { annotation?: { roles?: Roles } }[] = [];
const baselines: Record<string, unknown>[] = [];
const zones: Record<string, unknown>[] = [];
const axes: Record<string, unknown>[] = [];
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
  const record = (into: Record<string, unknown>[]) => (props: Record<string, unknown>) => {
    into.push(props);
    return null;
  };
  return {
    ...charts,
    ...inert,
    ChartContainer,
    ChartRow: through,
    Layers: through,
    Baseline: record(baselines),
    Zone: record(zones),
    YAxis: ({ onMouse: _m, format: _f, ...rest }: Record<string, unknown>) => {
      axes.push(rest);
      return null;
    },
  };
});
vi.mock('./useMeasuredWidth.js', () => ({ useMeasuredWidth: () => [{ current: null }, 800] }));

const { defaultTheme } = await import('@pond-ts/charts');
const { TimeSeriesChart } = await import('./TimeSeriesChart.js');
const { levelRole, levelRoles, rowLevelMarks, configAxisId } = await import('./index.js');
const { FALLBACK_REGISTER } = await import('./levels.js');

const cfg = (id: string, over: Partial<SeriesConfig> = {}): SeriesConfig => ({
  id,
  column: 'close',
  label: id,
  color: '#3366cc',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  source: 'price',
  ...over,
});

const level = (over: Partial<ChartLevel> = {}): ChartLevel =>
  ({
    kind: 'level',
    id: 'last',
    series: 'iv',
    value: 20.36,
    color: '#cc8800',
    ...over,
  }) as ChartLevel;
const range = (over: Partial<ChartLevel> = {}): ChartLevel =>
  ({
    kind: 'range',
    id: 'ext',
    series: 'iv',
    low: 18.1,
    high: 24.7,
    color: '#cc8800',
    ...over,
  }) as ChartLevel;

describe('rowLevelMarks', () => {
  const iv = cfg('iv');

  it("draws a level on its series' axis, with no chip by default", () => {
    expect(rowLevelMarks([level()], [iv], 'r1')).toEqual({
      lines: [
        {
          key: levelRole('r1', 'last'),
          role: levelRole('r1', 'last'),
          axis: 'r1:L',
          value: 20.36,
          label: false,
        },
      ],
      washes: [],
    });
  });

  it('carries a label', () => {
    expect(rowLevelMarks([level({ label: 'Last' })], [iv], 'r1').lines[0]!.label).toBe('Last');
  });

  it('follows the series onto its side and its own axis', () => {
    expect(rowLevelMarks([level()], [cfg('iv', { axis: 'R' })], 'r1').lines[0]!.axis).toBe('r1:R');
    const own = cfg('iv', { axisGroup: 'g1' });
    expect(rowLevelMarks([level()], [own], 'r1').lines[0]!.axis).toBe(configAxisId('r1', own));
  });

  it('draws nothing for a series that is not drawn (hidden, or another row)', () => {
    expect(rowLevelMarks([level({ series: 'gone' })], [iv], 'r1')).toEqual({
      lines: [],
      washes: [],
    });
  });

  it('draws a range as two lines, and a wash only when it has a fill', () => {
    const bare = rowLevelMarks([range({ labels: { high: 'High' } })], [iv], 'r1');
    expect(bare.lines).toEqual([
      {
        key: `${levelRole('r1', 'ext')}\u0000low`,
        role: levelRole('r1', 'ext'),
        axis: 'r1:L',
        value: 18.1,
        label: false,
      },
      {
        key: `${levelRole('r1', 'ext')}\u0000high`,
        role: levelRole('r1', 'ext'),
        axis: 'r1:L',
        value: 24.7,
        label: 'High',
      },
    ]);
    expect(bare.washes).toEqual([]);
    expect(rowLevelMarks([range({ fill: 0 })], [iv], 'r1').washes).toEqual([]);
    expect(rowLevelMarks([range({ fill: 0.1 })], [iv], 'r1').washes).toEqual([
      {
        key: `${levelRole('r1', 'ext')}\u0000fill`,
        role: levelRole('r1', 'ext'),
        axis: 'r1:L',
        from: 18.1,
        to: 24.7,
      },
    ]);
  });

  it('skips a non-finite value, and on a log axis one at or below zero', () => {
    expect(rowLevelMarks([level({ value: NaN })], [iv], 'r1').lines).toEqual([]);
    expect(rowLevelMarks([level({ value: 0 })], [iv], 'r1').lines).toHaveLength(1);
    expect(rowLevelMarks([level({ value: 0 })], [iv], 'r1', () => true).lines).toEqual([]);
    // A range keeps its good edge and loses its wash.
    const r = rowLevelMarks([range({ low: -1, fill: 0.1 })], [iv], 'r1', () => true);
    expect(r.lines.map((l) => l.value)).toEqual([24.7]);
    expect(r.washes).toEqual([]);
  });

  it('is empty for no levels', () => {
    expect(rowLevelMarks(undefined, [iv], 'r1')).toEqual({ lines: [], washes: [] });
  });
});

describe('levelRoles', () => {
  const rows = (levels: ChartLevel[]) => [{ id: 'r1', levels }];

  it('resolves the colour and always states a dash, so solid stays solid', () => {
    const roles = levelRoles(rows([level({ color: 'amber' })]), (c) =>
      c === 'amber' ? '#cc8800' : c,
    );
    expect(roles[levelRole('r1', 'last')]).toEqual({ color: '#cc8800', dash: [] });
  });

  it('takes the texture, the opacity and a range fill', () => {
    const roles = levelRoles(
      rows([range({ lineDash: 'dashed', opacity: 0.5, fill: 0.12 })]),
      (c) => c,
    );
    const r = roles[levelRole('r1', 'ext')]!;
    expect(r.dash.length).toBeGreaterThan(0);
    expect(r.color).not.toBe('#cc8800'); // alpha folded in
    expect(r.fillOpacity).toBe(0.12);
  });

  it('dims with the series it rides on', () => {
    const plain = levelRoles(rows([level()]), (c) => c)[levelRole('r1', 'last')]!.color;
    const dim = levelRoles(rows([level()]), (c) => c, new Set(['iv']))[levelRole('r1', 'last')]!
      .color;
    expect(dim).not.toBe(plain);
  });
});

describe('TimeSeriesChart — row levels', () => {
  const DAY = 86_400_000;
  const data: PriceRow[] = [];
  for (let d = 0; d < 30; d += 1) {
    const v = 20 + Math.sin(d / 3) * 2;
    data.push([Date.UTC(2026, 0, 1) + d * DAY, v, v + 0.5, v - 0.5, v, 1000]);
  }
  const price = buildPriceSeries('X', data) as unknown as ChartSeries;

  const render = (
    levels: ChartLevel[] | undefined,
    over: Partial<SeriesConfig> = {},
    props: Partial<TimeSeriesChartProps> = {},
  ) => {
    themes.length = 0;
    baselines.length = 0;
    zones.length = 0;
    axes.length = 0;
    act(() => {
      create(
        <TimeSeriesChart
          rows={[{ id: 'r', height: 200, configs: [cfg('iv', over)], levels }]}
          sources={{ price }}
          theme={defaultTheme}
          {...props}
        />,
      );
    });
  };

  it('draws a level as an inert baseline in its own role, and a range with its wash', () => {
    render([level({ label: 'Last' }), range({ fill: 0.1, lineDash: 'dotted' })]);
    expect(baselines.map((b) => [b.value, b.axis, b.role, b.label, b.selectable])).toEqual([
      [20.36, 'r:L', levelRole('r', 'last'), 'Last', false],
      [18.1, 'r:L', levelRole('r', 'ext'), false, false],
      [24.7, 'r:L', levelRole('r', 'ext'), false, false],
    ]);
    expect(zones.map((z) => [z.from, z.to, z.axis, z.role])).toEqual([
      [18.1, 24.7, 'r:L', levelRole('r', 'ext')],
    ]);
    const roles = themes.at(-1)!.annotation!.roles!;
    expect(roles[levelRole('r', 'last')]).toEqual({ color: '#cc8800', dash: [] });
    expect(roles[levelRole('r', 'ext')]!.fillOpacity).toBe(0.1);
  });

  it('hides with the series it rides on', () => {
    render([level()], { visible: false });
    expect(baselines).toEqual([]);
  });

  it('draws nothing for a series whose column is absent', () => {
    render([level()], { column: 'nope' });
    expect(baselines).toEqual([]);
  });

  it('dims with a dimmed series', () => {
    render([level()], {}, { dimmed: ['iv'] });
    expect(themes.at(-1)!.annotation!.roles![levelRole('r', 'last')]!.color).not.toBe('#cc8800');
  });

  it('skips a value at or below zero on a log axis', () => {
    render([level({ value: 0 })], {}, { axisOptions: { 'r:L': { scaleType: 'log' } } });
    expect(baselines).toEqual([]);
  });

  // This pins the PROPS path only: charts is stubbed here, so its own
  // auto-fit is not under test. That a <Baseline>/<Zone> never feeds the fit
  // is a property of charts (they register with no extent), read in its source.
  it('never moves the axis', () => {
    render(undefined);
    expect(axes.length).toBeGreaterThan(0);
    const without = JSON.stringify(axes);
    // A level far outside the data (≈18–22) still leaves the axis as it was.
    render([level({ value: 90 }), range({ low: -50, high: 300, fill: 0.1 })]);
    expect(JSON.stringify(axes)).toBe(without);
  });

  it('on a theme with no register, a level does not recolour the other marks', () => {
    const bare = { ...defaultTheme, annotation: undefined };
    render(undefined, {}, { theme: bare });
    expect(themes.at(-1)!.annotation).toBeUndefined();
    render([level()], {}, { theme: bare });
    const ann = themes.at(-1)!.annotation as { color: string; roles: Roles };
    expect(ann.color).toBe(FALLBACK_REGISTER.color);
    expect(Object.keys(ann.roles)).toEqual([levelRole('r', 'last')]);
  });

  it('keeps the theme’s own register (and its roles) under the level roles', () => {
    render([level()]);
    const ann = themes.at(-1)!.annotation as { color: string; roles: Roles };
    expect(ann.color).toBe(defaultTheme.annotation!.color);
    expect(Object.keys(ann.roles)).toContain(levelRole('r', 'last'));
  });
});
