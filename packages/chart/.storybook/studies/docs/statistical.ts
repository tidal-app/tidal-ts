import type { StudyDoc } from '../types.js';

export const STATISTICAL: Readonly<Record<string, StudyDoc>> = {
  linearRegression: {
    name: 'Linear Regression',
    what: 'Fits a straight line through the last N closes (least squares) and reports five facts about that line: where it ends today, how steep it is, where it started, its angle, and how well a straight line explains the prices (R²).',
    uses: [
      'Value is a low-lag moving average: the end point of the fitted line follows price more closely than an SMA of the same length.',
      'Slope says which way and how fast the recent trend is moving; a slope crossing zero is a trend change.',
      'R² near 1 means prices have moved in a clean straight line (a strong, orderly trend); near 0 means no linear trend.',
      'Mean reversion traders measure how far price has strayed from the regression line.',
    ],
    params: { period: 'Number of bars in each fit.' },
    outputs: {
      Value: 'The fitted line’s value at today’s bar.',
      Slope: 'Change in the fitted line per bar, in price units.',
      Intercept: 'The fitted line’s value at the oldest bar of the window.',
      Angle:
        'The slope as an angle in degrees. It depends on the price scale, so compare it only with itself.',
      R2: 'R²: the share of the price variation the line explains, 0 to 1.',
    },
    note: 'All five outputs share one axis here, so Value and Intercept (price-sized numbers) squash Slope, Angle and R² flat near zero. Hover the chart to read them. Tidal draws every multi-output study on one shared axis today.',
  },
  timeSeriesForecast: {
    name: 'Time Series Forecast (TSF)',
    what: 'The same straight-line fit as Linear Regression, extended one bar further: where the recent trend line says the next bar would land. It is plotted on today’s bar.',
    uses: [
      'Used as a fast moving average that leads price slightly in a steady trend.',
      'Price crossing the forecast line is used as a trend signal.',
      'The Chande Forecast Oscillator measures the gap between price and this line.',
    ],
    params: { period: 'Number of bars in the fit.' },
  },
  zScore: {
    name: 'Z-Score',
    what: 'How many standard deviations the price is from its moving average over the window. 0 is on the average, +2 is two standard deviations above it.',
    uses: [
      'Mean reversion: readings beyond ±2 mark prices that are stretched relative to their recent behaviour.',
      'Pairs and spread trading: the z-score of a spread is the usual trigger for entering and exiting.',
      'Because it is unit-free, it compares across instruments.',
    ],
    params: { period: 'Window for the average and the standard deviation.' },
  },
  rollingStdev: {
    name: 'Rolling Standard Deviation',
    what: 'The standard deviation of the price over the last N bars, in price units. A direct measure of how spread out recent prices are.',
    uses: [
      'Volatility measurement and comparison over time.',
      'The ingredient of Bollinger Bands and the Z-Score.',
      'Sizing stops and targets in price units.',
    ],
    params: { period: 'Window length, in bars.' },
    note: 'This is the standard deviation of price levels, not of returns. For return volatility use Historical Volatility.',
  },
  rollingMin: {
    name: 'Rolling Minimum',
    what: 'The lowest close of the last N bars.',
    uses: [
      'Trailing stops: exit a long position if price closes below the N-bar low.',
      'Breakdown signals: a close at a new N-bar low.',
      'Paired with Rolling Maximum it forms a close-based channel.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  rollingMax: {
    name: 'Rolling Maximum',
    what: 'The highest close of the last N bars.',
    uses: [
      'Breakout signals: a close at a new N-bar high.',
      'Trailing stops for a short position.',
      'Measuring drawdown: how far price is below its recent peak.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  rollingPercentile: {
    name: 'Rolling Percentile',
    what: 'The q-th percentile of the last N closes. At q = 90, 90% of recent closes were at or below this line.',
    uses: [
      'Robust channel lines: a 90th and a 10th percentile make a band that one extreme bar cannot stretch.',
      'Regime levels: is price trading in the top or bottom of its recent distribution?',
    ],
    params: {
      period: 'Window length, in bars.',
      q: 'Which percentile, 0 to 100. 50 is the rolling median.',
    },
  },
};
