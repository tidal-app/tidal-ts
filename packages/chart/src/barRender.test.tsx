import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { defaultTheme } from '@pond-ts/charts';
import { DEMO_INSTRUMENTS, generatePriceSeries } from '@tidal-ts/core';
import { TimeSeriesChart } from './TimeSeriesChart.js';
import type { SeriesConfig } from './series.js';
import type { ChartSeries } from './types.js';

const price = generatePriceSeries(DEMO_INSTRUMENTS[0]!, { bars: 60 }) as unknown as ChartSeries;

const bars = (column: string): SeriesConfig => ({
  id: 'b',
  column,
  label: 'b',
  color: '#c9a94a',
  axis: 'L',
  style: 'bar',
  visible: true,
  value: null,
  source: 'price',
});

describe('a bar config over a column the data does not carry', () => {
  // A study the engine skipped (an Awesome Oscillator whose fast period is
  // above its slow one) leaves no column. As a line it draws nothing; as bars
  // it used to throw out of the aggregate and take the whole chart down.
  it('draws nothing rather than throwing', () => {
    const render = (column: string) =>
      renderToString(
        <TimeSeriesChart
          rows={[{ id: 'r', height: 200, configs: [bars(column)] }]}
          sources={{ price }}
          theme={defaultTheme}
        />,
      );
    expect(() => render('close')).not.toThrow();
    expect(() => render('awesomeOscillator(high,low){fastPeriod:40}')).not.toThrow();
  });
});
