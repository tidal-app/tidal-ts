import type { StudyDoc } from '../types.js';

export const VOLUME: Readonly<Record<string, StudyDoc>> = {
  obv: {
    name: 'On-Balance Volume (OBV)',
    what: 'A running total of volume: a bar that closes up adds its whole volume, a bar that closes down subtracts it. The level itself means nothing; the direction of the line is the reading.',
    uses: [
      'Confirmation: a price uptrend with OBV rising too is backed by volume.',
      'Divergence: price making new highs while OBV does not suggests the rally lacks buyers.',
      'Breakouts: OBV breaking out ahead of price is read as accumulation before the move.',
    ],
  },
  accumulationDistribution: {
    name: 'Accumulation / Distribution Line (A/D)',
    what: 'A running total of volume, signed and scaled by where each bar closed within its own range. A close at the high adds the full volume, a close at the low subtracts it, and a close in the middle adds nothing. A finer version of OBV.',
    uses: [
      'Divergence with price: price rising while A/D falls suggests distribution (selling into strength).',
      'Trend confirmation, as with OBV.',
    ],
  },
  priceVolumeTrend: {
    name: 'Price Volume Trend (PVT)',
    what: 'A running total of volume multiplied by each bar’s percent price change. A 3% up day adds three times as much as a 1% up day, where OBV would count them the same.',
    uses: ['Trend confirmation and divergence, read the same way as OBV.'],
  },
  chaikinMoneyFlow: {
    name: 'Chaikin Money Flow (CMF)',
    what: 'The accumulation/distribution idea averaged over a window instead of totalled forever: for each bar, where it closed in its range, weighted by volume, then averaged. It runs from −1 to +1.',
    uses: [
      'Above zero means buying pressure dominated the window, below zero selling pressure.',
      'Readings beyond about ±0.25 are read as strong.',
      'Confirms breakouts: an upside break with CMF positive is better supported.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  chaikinOscillator: {
    name: 'Chaikin Oscillator',
    what: 'A MACD of the Accumulation/Distribution line: a 3-bar EMA of A/D minus a 10-bar EMA. It measures whether accumulation is speeding up or slowing down.',
    uses: [
      'Zero-line crossings as buy and sell signals.',
      'Divergence from price, especially at extremes.',
    ],
    params: {
      fastPeriod: 'Fast EMA of the A/D line.',
      slowPeriod: 'Slow EMA of the A/D line.',
    },
  },
  moneyFlowIndex: {
    name: 'Money Flow Index (MFI)',
    what: 'RSI calculated on money flow (typical price × volume) instead of on price, so big-volume days count for more. 0 to 100. Sometimes called volume-weighted RSI.',
    uses: [
      'Overbought above 80, oversold below 20.',
      'Divergence from price, often given more weight than RSI divergence because volume is included.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  twiggsMoneyFlow: {
    name: 'Twiggs Money Flow',
    what: 'A variant of Chaikin Money Flow that measures each bar against the true range (so gaps are counted) and uses smooth exponential averaging instead of a fixed window. −1 to +1.',
    uses: [
      'Above zero is accumulation, below zero distribution.',
      'Divergence with price, and crossings of zero, as with Chaikin Money Flow, but with fewer sudden jumps when an old bar drops out of the window.',
    ],
    params: { period: 'Smoothing length (Wilder’s method).' },
  },
  forceIndex: {
    name: 'Force Index',
    what: 'The bar’s price change times its volume, smoothed with an EMA. It combines direction, size of move and volume into one number.',
    uses: [
      "Elder's use: with a short (2-bar) setting, buy dips below zero in an uptrend and sell spikes above zero in a downtrend.",
      'With the longer 13-bar setting, zero-line crossings track the trend.',
      'Divergence between price and the 13-bar Force Index warns of a turn.',
    ],
    params: {
      period:
        'EMA length. 13 for trend, 2 for short-term timing; 1 gives the raw unsmoothed force.',
    },
  },
  klinger: {
    name: 'Klinger Volume Oscillator',
    what: 'Builds a "volume force" from volume, the bar’s range and whether the bar’s typical price rose or fell, then takes a fast EMA minus a slow EMA of it, with a signal line.',
    uses: [
      'Crossovers of the oscillator and its signal line, taken in the direction of the trend.',
      'Divergence between price and the oscillator.',
    ],
    params: {
      fastPeriod: 'Fast EMA of the volume force.',
      slowPeriod: 'Slow EMA of the volume force.',
      signalPeriod: 'EMA of the oscillator used as the signal.',
    },
    outputs: {
      Value: 'The oscillator.',
      Signal: 'An EMA of the oscillator.',
    },
    note: "This is Klinger's original formula. Some platforms ship a simplified version under the same name that gives different numbers.",
  },
  tradeVolumeIndex: {
    name: 'Trade Volume Index (TVI)',
    what: 'A running total of volume like OBV, but a bar only changes direction when the close moves by more than a minimum amount. A bar that barely moves keeps adding volume in the last direction.',
    uses: [
      'Meant for intraday data, to read whether volume is trading at the bid or the ask over time.',
      'Divergence and trend confirmation, as with OBV.',
    ],
    params: {
      minTick:
        'The smallest price move that counts as a change of direction, usually the instrument’s minimum tick.',
    },
  },
  negativeVolumeIndex: {
    name: 'Negative Volume Index (NVI)',
    what: 'An index that only moves on days when volume fell. On those days it compounds that day’s price change; on higher-volume days it stays flat. The idea is that informed money trades on quiet days.',
    uses: [
      "Fosback's rule: NVI above its one-year (about 255-day) moving average signals a bull market backdrop; below it, caution.",
      'Compared with the Positive Volume Index to see whether quiet-day or busy-day trading is driving the trend.',
    ],
    params: { start: 'The value the index starts at. It only sets the scale.' },
  },
  positiveVolumeIndex: {
    name: 'Positive Volume Index (PVI)',
    what: 'The twin of the Negative Volume Index: it only moves on days when volume rose, compounding that day’s price change. The idea is that this follows the crowd.',
    uses: [
      'The same rule as NVI: PVI above its one-year moving average is read as a bullish backdrop.',
      'Compared with NVI to see which kind of trading is leading.',
    ],
    params: { start: 'The value the index starts at. It only sets the scale.' },
  },
  marketFacilitationIndex: {
    name: 'Market Facilitation Index (BW MFI)',
    what: 'The bar’s range divided by its volume: how much price movement each unit of volume bought.',
    uses: [
      'Read together with the change in volume (four cases): index and volume both up means the move is being funded; index up with volume down is a move on thin participation; index down with volume up often comes before a breakout.',
    ],
    note: 'Bill Williams’ indicator, not the Money Flow Index, which shares the abbreviation MFI. The numbers depend on the instrument’s volume units.',
  },
  shinoharaIntensityRatio: {
    name: 'Shinohara Intensity Ratio',
    what: 'Two ratios over the window, as percentages. The "strong" ratio compares how far bars rose above their own open with how far they fell below it. The "weak" ratio does the same measured from the previous close, so gaps count. 100 is neutral for both.',
    uses: [
      'Readings above 100 mean buying pressure has dominated the window; below 100, selling pressure.',
      'Divergence between the two shows whether the strength is coming from inside the sessions or from the gaps between them.',
    ],
    params: { period: 'Window length, in bars.' },
    outputs: {
      Strong: 'Measured from each bar’s own open.',
      Weak: 'Measured from the previous bar’s close.',
    },
    note: 'Sources disagree on which ratio is called "strong" and which "weak"; the definitions above are the ones used here. On this page the two lines sit on top of each other because the practice data opens every bar exactly at the previous close (no gaps). On real data they separate whenever the market gaps.',
  },
  vwap: {
    name: 'Rolling VWAP',
    what: 'The average price weighted by volume over the last N bars, using each bar’s typical price. A bar with ten times the volume moves it ten times as far.',
    uses: [
      'A fair-value line: price above VWAP means buyers have been paying up on average, below means sellers have.',
      'Execution benchmark: large orders are judged on whether they filled better or worse than VWAP.',
      'Support and resistance, as with a moving average.',
    ],
    params: { period: 'Number of bars in the window.' },
    note: 'This is a rolling VWAP. The intraday VWAP that resets at each session open, and an anchored VWAP from a chosen date, need session or anchor information Tidal does not pass to studies yet.',
  },
};
