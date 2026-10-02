import type { StudyDoc } from '../types.js';

export const BANDS: Readonly<Record<string, StudyDoc>> = {
  bollingerBandwidth: {
    name: 'Bollinger BandWidth',
    what: 'How wide the Bollinger Bands are, as a percentage of the middle band: 100 × (upper − lower) ÷ middle. It turns the visual pinch and flare of the bands into a number.',
    uses: [
      'The squeeze: BandWidth at its lowest level in months means volatility has compressed, which often comes before a sharp move. Traders then wait for price to break out of the bands to pick a direction.',
      'Very high BandWidth after a big move often marks the end of that move, as volatility peaks.',
    ],
    params: {
      period: 'Bars in the underlying Bollinger moving average and standard deviation.',
      stdDev: 'Band distance in standard deviations, as in Bollinger Bands.',
    },
  },
  bollingerPercentB: {
    name: 'Bollinger %B',
    what: 'Where the price sits inside its Bollinger Bands, as a fraction: 1 is on the upper band, 0 on the lower band, 0.5 on the middle. Above 1 or below 0 means price is outside the bands.',
    uses: [
      'Overbought and oversold in a range: readings above 1 or below 0 are candidates to fade.',
      'Trend strength: in a strong trend %B stays above 0.5 (uptrend) or below it (downtrend) for long stretches.',
      'Divergence: a new price high with a lower %B means the push is weaker relative to volatility.',
      'Because it is normalized, it can be used inside trading rules and compared between instruments.',
    ],
    params: {
      period: 'Bars in the underlying Bollinger moving average and standard deviation.',
      stdDev: 'Band distance in standard deviations.',
    },
  },
  atrBands: {
    name: 'ATR Bands',
    what: 'Two lines placed a multiple of the Average True Range above and below the price itself. They show how far price would have to move to be an unusually large move for the current volatility.',
    uses: [
      'Stop placement: the lower band is a volatility-based stop for a long position, the upper band for a short.',
      'Profit targets: a move to the far band is a large move relative to recent volatility.',
      'Breakout filter: a close beyond the previous bar’s band is an unusually strong bar.',
    ],
    params: {
      period: 'Smoothing length of the ATR.',
      multiplier: 'How many ATRs the bands sit from price. 2 to 3 is common for stops.',
    },
    outputs: {
      Upper: 'Price plus multiplier × ATR.',
      Lower: 'Price minus multiplier × ATR.',
    },
    note: 'There is no middle line: the middle is the price itself, already on the chart. The pair is drawn as two lines rather than a shaded band for that reason.',
  },
  donchian: {
    name: 'Donchian Channel',
    what: 'The highest high and the lowest low of the last N bars, plus the halfway line between them. The channel only moves when a new extreme is made, so it looks like a staircase.',
    uses: [
      'Breakout trading: buy a close above the upper line (a new N-bar high), sell below the lower line. This is the basis of the famous "Turtle" trend-following system (20-day and 55-day breakouts).',
      'Trailing stops: exit a long when price falls to a shorter channel’s lower line.',
      'Range definition: a narrow channel marks a consolidation.',
    ],
    params: { period: 'The look-back window, in bars.' },
    outputs: {
      Upper: 'Highest high of the window.',
      Lower: 'Lowest low of the window.',
      Middle: 'Halfway between the two.',
    },
  },
  primeNumberBands: {
    name: 'Prime Number Bands',
    what: 'For each bar, the nearest prime number at or above the high and the nearest prime at or below the low. It treats prime numbers as price levels, the way other traders treat round numbers.',
    uses: [
      'Some traders watch these levels as possible support and resistance, much as they watch round numbers.',
      'It is a niche study with a small following, best used alongside more established tools rather than on its own.',
    ],
    outputs: {
      Upper: 'The smallest prime at or above the high.',
      Lower: 'The largest prime at or below the low.',
    },
    note: 'Only meaningful for prices above 2, and most useful when prices are in the tens to hundreds, where primes are close enough together to be levels. Drawn as two lines, with no middle.',
  },
};
