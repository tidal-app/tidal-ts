import type { StudyDoc } from '../types.js';

export const MOVING_AVERAGE: Readonly<Record<string, StudyDoc>> = {
  macd: {
    name: 'MACD (Moving Average Convergence Divergence)',
    what: 'The gap between a fast and a slow EMA of price (the MACD line), an EMA of that gap (the signal line), and the difference between the two (the histogram). When the fast average pulls away from the slow one, momentum is building in that direction.',
    uses: [
      'Signal-line crossovers: MACD crossing above its signal line is a buy signal, below a sell. The histogram crosses zero at exactly those points, which is why it is drawn as bars.',
      'Zero-line crossovers: the MACD line crossing zero means the fast EMA has crossed the slow one, a slower trend signal.',
      'Divergence: price making a new high while MACD makes a lower high warns that the move is losing momentum.',
      'A shrinking histogram shows momentum fading before the lines actually cross.',
    ],
    params: {
      fastPeriod: 'The fast EMA. Classic value 12.',
      slowPeriod: 'The slow EMA. Classic value 26.',
      signalPeriod: 'EMA of the MACD line used as the signal. Classic value 9.',
    },
    outputs: {
      Line: 'MACD line: fast EMA minus slow EMA, in price units.',
      Signal: 'Signal line: an EMA of the MACD line.',
      Hist: 'Histogram: MACD line minus signal line, drawn as bars.',
    },
  },
  trix: {
    name: 'TRIX',
    what: 'The one-bar percent change of a triple-smoothed EMA. Smoothing three times strips out almost all the short-term noise, leaving a slow momentum line that crosses zero when the smoothed trend turns.',
    uses: [
      'Zero-line crossings as trend signals: above zero the smoothed trend is rising.',
      'Crossovers of TRIX and its signal line as earlier, more frequent signals.',
      'Divergence from price, as with MACD.',
    ],
    params: {
      period: 'Length of each of the three EMAs.',
      signalPeriod: 'EMA of the TRIX line used as the signal.',
    },
    outputs: {
      Value: 'The TRIX line, in percent per bar.',
      Signal: 'An EMA of the TRIX line.',
    },
  },
  schaffTrendCycle: {
    name: 'Schaff Trend Cycle (STC)',
    what: 'Takes a MACD and runs a stochastic over it twice, so it is rescaled to 0 to 100 against its own recent range. The result swings between the extremes on every cycle and turns earlier than the MACD it is built from.',
    uses: [
      'Buy when STC rises up through 25; sell when it falls down through 75.',
      'Flat at 100 or 0 means a strong trend; traders wait for it to leave the extreme before acting.',
      'Popular in currency trading for catching turns earlier than MACD.',
    ],
    params: {
      fastPeriod: 'Fast EMA of the underlying MACD.',
      slowPeriod: 'Slow EMA of the underlying MACD.',
      cyclePeriod: 'Window for both stochastic passes, in bars.',
    },
  },
  coppock: {
    name: 'Coppock Curve',
    what: 'Adds a 14-period and an 11-period percent rate of change together and smooths the sum with a 10-period weighted moving average. It was designed on monthly data to spot the bottoms of major stock-market declines.',
    uses: [
      'The classic signal is a buy when the curve turns up from below zero, read on a monthly chart of a broad index.',
      'It was never intended as a sell signal; some traders use a downturn from above zero, but that is not the original rule.',
    ],
    params: {
      longPeriod: 'The longer rate-of-change look-back. Coppock used 14 months.',
      shortPeriod: 'The shorter rate-of-change look-back. Coppock used 11 months.',
      wmaPeriod: 'Length of the weighted moving average that smooths the sum. Coppock used 10.',
    },
    note: 'The periods are counted in bars, so on daily data 14 means 14 days, not 14 months. To read it the classic way you need monthly bars.',
  },
  kst: {
    name: 'Know Sure Thing (KST)',
    what: "Pring's momentum line: four rates of change over 10, 15, 20 and 30 bars, each smoothed, weighted 1, 2, 3 and 4 and added up. The longer horizons carry more weight, so it follows the main trend but can still turn early. A simple moving average of it is the signal line.",
    uses: [
      'Crossovers of KST and its signal line as buy and sell signals.',
      'Zero-line crossings as confirmation of the trend direction.',
      'Divergence from price as an early warning of a turn.',
    ],
    params: {
      signalPeriod:
        'Length of the simple moving average used as the signal line. The twelve numbers that define KST itself are fixed.',
    },
    outputs: {
      Value: 'The KST line.',
      Signal: 'A simple moving average of KST.',
    },
  },
  specialK: {
    name: 'Pring’s Special K',
    what: 'An extended Know Sure Thing: twelve smoothed rates of change instead of four, in short-term, intermediate and long-term groups reaching out to 530 bars. It packs the momentum of the whole business cycle into one line.',
    uses: [
      'Read as a primary-trend indicator: its own peaks and troughs mark the major turns that a four-term KST is too fast to call.',
      'Trend changes are confirmed when the line crosses a smoothed version of itself (you can add an SMA of it in Tidal).',
    ],
    note: 'Needs about 724 bars before its first value, so this page uses a longer history than the others. Designed for daily data.',
    bars: 1100,
  },
  priceMomentumOscillator: {
    name: 'Price Momentum Oscillator (PMO)',
    what: "DecisionPoint's momentum line: the one-bar percent change, smoothed twice with custom exponential averages and scaled by ten, with a 10-bar EMA as a signal line. Double smoothing turns a noisy daily change into a slow, readable momentum wave.",
    uses: [
      'Crossovers of PMO and its signal line, especially when they happen far from zero.',
      'Zero-line crossings for the trend direction.',
      'Because PMO is a percentage it can be compared across instruments, which makes it useful for ranking relative strength.',
    ],
    outputs: {
      Value: 'The PMO line.',
      Signal: 'A 10-bar EMA of PMO.',
    },
  },
};
