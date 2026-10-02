import type { StudyDoc } from '../types.js';

export const VOLATILITY: Readonly<Record<string, StudyDoc>> = {
  realizedVol: {
    name: 'Realized Volatility',
    what: 'Turns a daily variance into an annualized volatility in percent: the square root of (variance × 252), times 100. It is how much the underlying actually moved, put on the same scale options traders quote implied volatility in.',
    uses: [
      'Implied versus realized: comparing what options are pricing (implied vol) with what the stock is actually doing (realized vol). When implied sits well above realized, options look expensive; well below, cheap. This spread is the core of volatility trading.',
      'Regime: a jump in realized vol marks a change in how violently the stock is trading, which feeds position sizing and hedging frequency.',
    ],
    note: 'This study expects a daily VARIANCE as its input, not a price. On this page it reads the fixture’s close-to-close variance, and the top panel shows the fixture’s 21-day implied vol for comparison. It is Tidal’s own study and has no parameters: any averaging window belongs to the variance it is given.',
  },
  atr: {
    name: 'Average True Range (ATR)',
    what: 'The average size of a bar, in price units, counting gaps. Each bar\'s "true range" is the widest of: high to low, high to the previous close, and low to the previous close. ATR is Wilder\'s smoothed average of that.',
    uses: [
      'Stop placement: stops are often set a multiple of ATR away from entry (for example 2 × ATR), so they sit outside normal noise.',
      'Position sizing: risking a fixed amount per trade means fewer shares when ATR is high.',
      'Volatility filter: a rising ATR means bigger bars and a more active market; it says nothing about direction.',
      'The building block for ATR Bands, Keltner Channels and many trailing stops.',
    ],
    params: { period: 'Smoothing length. Wilder used 14.' },
  },
  historicalVolatility: {
    name: 'Historical Volatility',
    what: 'The standard deviation of daily log returns over the window, annualized by multiplying by the square root of the number of trading periods in a year. It is the textbook "realized vol" calculated straight from prices.',
    uses: [
      'Compare with implied volatility to judge whether options are rich or cheap.',
      'Track volatility regimes: low historical vol tends to be followed by higher vol, and the reverse (volatility mean-reverts).',
      'Size positions and set expectations for how far a stock might move.',
    ],
    params: {
      period: 'Number of returns in the window. 20 is about one trading month.',
      annualize:
        'Periods per year used to scale up: 252 for daily bars, 52 for weekly, 12 for monthly.',
    },
    note: 'The output is a decimal: 0.25 means 25% annualized volatility.',
  },
  chaikinVolatility: {
    name: 'Chaikin Volatility',
    what: 'Smooths the high-low range of each bar with an EMA, then reports the percent change in that smoothed range over a number of bars. It tells you whether bars are getting wider or narrower, not how wide they are.',
    uses: [
      "Chaikin's reading: a sharp rise in volatility over a short time often accompanies a market top (panic widens bars); a slow decline over a longer time often comes with a bottom.",
      'An early warning that a quiet market is starting to move.',
    ],
    params: {
      period: 'EMA length used to smooth the high-low range.',
      rocPeriod: 'How many bars back the smoothed range is compared against.',
    },
  },
  massIndex: {
    name: 'Mass Index',
    what: 'Watches for the range of bars widening relative to its own average, ignoring direction. It sums 25 bars of (EMA of range ÷ EMA of that EMA), so a quiet market reads near 25.',
    uses: [
      'The "reversal bulge": the index climbs above 27 and then falls back below 26.5. Dorsey read this as a warning that the current trend is about to reverse.',
      'It does not say which way, so it is paired with a trend study (for example a moving average) to pick the direction.',
    ],
    params: {
      emaPeriod: 'Length of both EMAs applied to the range. Dorsey used 9.',
      sumPeriod: 'How many bars of the ratio are added up. Dorsey used 25.',
    },
  },
  choppinessIndex: {
    name: 'Choppiness Index',
    what: 'Compares the total distance price travelled (the sum of true ranges) with the ground it actually covered (the window’s high-to-low range), on a 0 to 100 scale. A market that zig-zagged in a tight box reads high; one that went in a straight line reads low.',
    uses: [
      'Above 61.8: choppy and sideways, so range tactics fit better.',
      'Below 38.2: trending, so trend-following tactics fit better.',
      'A long stretch of high readings is often followed by a breakout. It does not say which direction.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  gopalakrishnanRangeIndex: {
    name: 'Gopalakrishnan Range Index (GAPO)',
    what: 'The logarithm of the high-to-low range over the window, divided by the logarithm of the window length. A compressed range reads low and an expanding one reads high.',
    uses: [
      'Compare the reading to its own recent history rather than to a fixed level.',
      'Look for a squeeze (unusually low readings) followed by expansion as a sign a breakout is under way.',
    ],
    params: { period: 'Window length, in bars.' },
    note: 'The number depends on the instrument’s price level, so it is not comparable between different instruments.',
  },
  ulcerIndex: {
    name: 'Ulcer Index',
    what: 'A volatility measure that only counts the downside. For each bar it takes the percent drop from the highest close in the window, then reports the root-mean-square of those drops. Deep drawdowns count much more than shallow ones.',
    uses: [
      'Judging how painful it is to hold something: lower is calmer.',
      'Risk-adjusted performance: dividing excess return by the Ulcer Index (the Martin ratio) is an alternative to the Sharpe ratio that ignores upside volatility.',
      'Spotting when a stock has entered a sustained drawdown.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  relativeVolatilityIndex: {
    name: 'Relative Volatility Index (RVI)',
    what: 'The RSI formula applied to volatility instead of price changes. It splits recent standard deviation into the part that happened on up days and the part on down days, and reports the up share as 0 to 100.',
    uses: [
      'Designed as a confirmation tool: buy signals from other studies are trusted when RVI is above 50, sell signals when it is below 50.',
      'A breakout that RSI likes but RVI does not is happening on falling volatility, which is a warning.',
    ],
    params: {
      period:
        'Smoothing length for the up and down parts (Wilder’s method, as in RSI). Dorsey used 14.',
      stdevPeriod: 'Window for the standard deviation measured on each bar. Dorsey used 10.',
    },
    note: 'Not the same as the Relative Vigor Index, which is also abbreviated RVI.',
  },
};
