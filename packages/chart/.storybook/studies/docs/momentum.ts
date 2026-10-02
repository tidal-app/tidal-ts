import type { StudyDoc } from '../types.js';

export const MOMENTUM: Readonly<Record<string, StudyDoc>> = {
  rsi: {
    name: 'Relative Strength Index (RSI)',
    what: 'Compares the size of recent up moves with recent down moves and puts the answer on a 0 to 100 scale. 100 would mean every move in the window was up; 50 means up and down moves were equal. It uses Wilder’s smoothing, so older moves fade out gradually.',
    uses: [
      'Overbought and oversold: above 70 is read as overbought and below 30 as oversold. In a range these are fade signals; in a strong trend RSI can stay overbought for a long time, so many traders wait for it to come back through the level.',
      'Divergence: price makes a new high but RSI makes a lower high, a warning that the move is tiring.',
      'Trend regime: in uptrends RSI tends to hold above 40, in downtrends below 60, which helps read pullbacks.',
      'Failure swings and the 50 line are used as momentum confirmation.',
    ],
    params: {
      period:
        'Smoothing length. Wilder used 14; shorter makes it swing to the extremes more often.',
    },
  },
  stochastic: {
    name: 'Stochastic Oscillator',
    what: 'Where the close sits within the high-low range of the last N bars, as 0 to 100: 100 is a close at the top of the range, 0 at the bottom. The raw value is smoothed into %K, and %K is smoothed again into %D.',
    uses: [
      'Overbought above 80, oversold below 20, best used in sideways markets.',
      'Crossovers of %K and %D, especially inside the overbought or oversold zones.',
      'Divergence between price and the oscillator as a turning-point warning.',
    ],
    params: {
      kPeriod: 'The look-back window for the high-low range.',
      slowing:
        'Smoothing applied to the raw value to get %K. 3 gives the common "slow" stochastic; 1 gives the jumpier "fast" stochastic.',
      dPeriod: 'Simple moving average of %K used as %D.',
    },
    outputs: {
      K: '%K: the (smoothed) position of the close in the range.',
      D: '%D: a moving average of %K, the signal line.',
    },
  },
  stochasticMomentumIndex: {
    name: 'Stochastic Momentum Index (SMI)',
    what: 'A refined stochastic. Instead of measuring the close from the bottom of the range it measures it from the middle, so the result is signed: +100 at the top of the range, −100 at the bottom, 0 in the middle. Both parts are smoothed twice, which makes it much quieter than the plain stochastic.',
    uses: [
      'Overbought above +40 and oversold below −40 are common thresholds.',
      'Crossovers of the SMI and its signal line as entries.',
      'Zero-line crossings as a trend change.',
    ],
    params: {
      period: 'Look-back window for the high-low range.',
      longPeriod: 'First smoothing (EMA) length.',
      shortPeriod: 'Second smoothing (EMA) length.',
      signalPeriod: 'EMA of the SMI used as the signal line.',
    },
    outputs: {
      Value: 'The SMI line.',
      Signal: 'An EMA of the SMI.',
    },
  },
  stochasticRsi: {
    name: 'Stochastic RSI',
    what: 'The stochastic formula applied to RSI instead of price: where RSI sits within its own recent range, 0 to 100. RSI spends most of its time between 40 and 60, so this rescaling makes the extremes come up far more often.',
    uses: [
      'A faster overbought/oversold signal: above 80 and below 20.',
      'Crossovers of %K and %D for short-term timing.',
      'It is very sensitive, so it is usually combined with a trend filter to avoid acting on every swing.',
    ],
    params: {
      rsiPeriod: 'Length of the RSI underneath.',
      stochPeriod: 'Look-back window for RSI’s high and low.',
      kPeriod: 'Simple moving average applied to give %K.',
      dPeriod: 'Simple moving average of %K giving %D.',
    },
    outputs: {
      K: '%K: the smoothed position of RSI in its range.',
      D: '%D: a moving average of %K.',
    },
  },
  williamsR: {
    name: 'Williams %R',
    what: 'How far the close is below the highest high of the window, as a percentage of the range, from 0 (closed at the high) to −100 (closed at the low). It is the stochastic turned upside down.',
    uses: [
      'Overbought above −20, oversold below −80.',
      'A move out of the extreme zone (for example back below −20) is often used as the actual signal.',
      'Divergence from price as a warning.',
    ],
    params: { period: 'The look-back window, in bars.' },
  },
  chandeMomentum: {
    name: 'Chande Momentum Oscillator (CMO)',
    what: 'The sum of up moves minus the sum of down moves, divided by their total, over the window, on a −100 to +100 scale. Unlike RSI it uses plain sums with no smoothing, so it reacts faster and swings further.',
    uses: [
      'Overbought above +50, oversold below −50.',
      'Its distance from zero is a measure of trend strength.',
      'Crossovers of a moving average of CMO as signals.',
    ],
    params: { period: 'Window length, in bars.' },
  },
  momentum: {
    name: 'Momentum',
    what: 'Today’s price minus the price N bars ago, in price units. Positive when price is higher than it was, negative when lower.',
    uses: [
      'Zero-line crossings as a simple trend signal.',
      'The slope shows whether a move is speeding up or slowing down.',
      'Divergence from price as an early warning.',
    ],
    params: { period: 'How many bars back to compare against.' },
    note: 'Because it is in price units it cannot be compared between instruments at different prices. Rate of Change is the percentage version.',
  },
  percentChange: {
    name: 'Rate of Change (ROC)',
    what: 'The percentage change from N bars ago. Also called ROC. With the default of 1 it is simply the daily return.',
    uses: [
      'Comparing momentum across instruments, since it is a percentage.',
      'Zero-line crossings and divergence, as with Momentum.',
      'Extreme readings compared with the instrument’s own history can flag stretched moves.',
    ],
    params: { periods: 'How many bars back to compare against.' },
  },
  intradayMomentumIndex: {
    name: 'Intraday Momentum Index (IMI)',
    what: 'RSI’s question asked of the candle bodies: of all the open-to-close movement in the window, what share went up? 0 to 100. It ignores gaps between bars and looks only at what happened within each one.',
    uses: [
      'Overbought above 70 and oversold below 30, as with RSI.',
      'A market that gaps up every morning then sells off all day looks strong on RSI but weak on IMI. That disagreement is what it was built to show.',
      'Popular for timing short-term option trades.',
    ],
    params: { period: 'Window length, in bars.' },
    note: 'The practice data on this page has no overnight gaps, so IMI and RSI tell a similar story here. The difference shows on real data, where gaps matter.',
  },
  awesomeOscillator: {
    name: 'Awesome Oscillator (AO)',
    what: 'A 5-bar simple average of each bar’s midpoint (high + low) ÷ 2, minus a 34-bar one. It shows whether short-term momentum is stronger or weaker than longer-term momentum.',
    uses: [
      'Zero-line crossings as trend signals.',
      'The "saucer": three bars on the same side of zero that dip and then turn back, read as continuation.',
      'The "twin peaks": two troughs below zero with the second one higher, read as a bullish reversal (and the mirror for bearish).',
    ],
    params: {
      fastPeriod: 'The short simple average. Williams used 5.',
      slowPeriod: 'The long simple average. Williams used 34.',
    },
    note: 'Usually drawn as a histogram coloured by whether each bar is higher or lower than the last. Here it is drawn as a line.',
  },
  ultimateOscillator: {
    name: 'Ultimate Oscillator',
    what: 'Buying pressure (the close relative to the true low) as a share of true range, averaged over three windows (7, 14 and 28 bars) and combined with the shortest weighted most. 0 to 100.',
    uses: [
      "Williams' buy signal: a bullish divergence where price makes a lower low but the oscillator does not, with the low below 30, followed by a break above the divergence high.",
      'Overbought above 70 and oversold below 30.',
      'Using three windows at once cuts down the false signals a single-window oscillator gives.',
    ],
    params: {
      shortPeriod: 'The short window (weight 4).',
      mediumPeriod: 'The medium window (weight 2).',
      longPeriod: 'The long window (weight 1).',
    },
  },
  commodityChannelIndex: {
    name: 'Commodity Channel Index (CCI)',
    what: 'How far the typical price (high + low + close) ÷ 3 is from its moving average, measured in mean absolute deviations and scaled so that most readings fall between −100 and +100.',
    uses: [
      'Breakouts: a move above +100 can mark the start of a strong uptrend, below −100 a downtrend.',
      'Mean reversion: extreme readings (beyond ±200) are candidates to fade in a range.',
      'Zero-line crossings and divergence.',
    ],
    params: { period: 'Window for the moving average and the deviation.' },
  },
  fisherTransform: {
    name: 'Fisher Transform',
    what: 'Puts each bar’s midpoint on a −1 to +1 scale within its recent range, then stretches the ends with a mathematical transform so turning points show up as sharp spikes instead of gentle curves. The signal line is simply the Fisher line one bar earlier.',
    uses: [
      'Turning points: an extreme reading that reverses marks a likely turn.',
      'Crossings of the Fisher line and its signal (yesterday’s value), which is just a change of direction.',
      'Zero-line crossings as a trend signal.',
    ],
    params: { period: 'The look-back window for the high-low range.' },
    outputs: {
      Value: 'The Fisher line.',
      Signal: 'The Fisher line delayed by one bar.',
    },
  },
  psychologicalLine: {
    name: 'Psychological Line',
    what: 'The percentage of the last N bars that closed higher than the bar before. It ignores how big the moves were and only counts which way they went.',
    uses: [
      'Above 75 is read as over-optimistic, below 25 as over-pessimistic, both as contrarian signals.',
      'A quick gauge of how persistent a move has been.',
    ],
    params: { period: 'Number of bars counted.' },
  },
  prettyGoodOscillator: {
    name: 'Pretty Good Oscillator (PGO)',
    what: 'How far the close is from its simple moving average, measured in average daily ranges (an EMA of true range). +2.5 means the close is two and a half typical days’ range above its average.',
    uses: [
      "Johnson's rule: go long when it rises above +3, short when it falls below −3, and exit when it comes back to zero (price back at its average).",
      'Because it is measured in ranges, the same number means the same thing across instruments and volatility regimes.',
    ],
    params: { period: 'Length of both the simple moving average and the true-range average.' },
  },
  primeNumberOscillator: {
    name: 'Prime Number Oscillator',
    what: 'The distance from the price to the prime number nearest to it, positive when price is above that prime and negative when below.',
    uses: [
      'Used by a small number of traders who treat primes as price levels, to see whether price is leaning above or below the nearest one.',
      'A niche study; best paired with more established tools.',
    ],
    note: 'Only meaningful for prices above 2.',
  },
  relativeVigorIndex: {
    name: 'Relative Vigor Index (RVI)',
    what: 'The candle body (close − open) as a fraction of the bar’s range (high − low), lightly smoothed and summed over the window. The idea: in an uptrend prices tend to close near the high, in a downtrend near the low.',
    uses: [
      'Crossovers of RVI and its signal line, the main signal.',
      'Divergence from price as a warning.',
    ],
    params: { period: 'Window the smoothed body and range are summed over.' },
    outputs: {
      Value: 'The RVI line.',
      Signal: 'A short weighted average of RVI.',
    },
    note: 'Not the same as the Relative Volatility Index, which is also abbreviated RVI.',
  },
  centerOfGravity: {
    name: 'Center of Gravity (CG)',
    what: 'Ehlers’ "balance point" of the prices in the window, measured in bars back from today. Recent prices are given positions 1, 2, 3 and so on; the reading is where their weighted average falls. It moves up as recent prices rise, with very little lag.',
    uses: [
      'Turning points: crossings of the line with a one-bar-delayed copy of itself (add an EMA or SMA of it in Tidal for a smoother trigger).',
      'Cycle trading: it oscillates with the market’s swings and turns close to them.',
    ],
    params: { period: 'Window length, in bars.' },
    note: 'The value is negative by construction: on a flat market it sits at −(period + 1) ÷ 2. Only its movement matters.',
  },
  chandeForecastOscillator: {
    name: 'Chande Forecast Oscillator (CFO)',
    what: 'How far the price is from the value a straight-line fit of recent prices would have predicted for today, as a percentage of price.',
    uses: [
      'Positive readings mean price is running ahead of its own trend line; persistently positive is an uptrend, persistently negative a downtrend.',
      'Zero-line crossings mark where price meets its forecast.',
    ],
    params: { period: 'Number of bars in the straight-line fit.' },
  },
  trueStrengthIndex: {
    name: 'True Strength Index (TSI)',
    what: 'The bar-to-bar change smoothed twice, divided by the size of the change smoothed the same way. It is the share of recent motion that went one way, from −100 (every bar down) to +100 (every bar up).',
    uses: [
      'Crossovers of TSI and its signal line.',
      'Zero-line crossings for the trend direction.',
      'Overbought and oversold levels that depend on the instrument; around ±25 is common.',
      'Divergence from price.',
    ],
    params: {
      longPeriod: 'The first (longer) smoothing.',
      shortPeriod: 'The second (shorter) smoothing.',
      signalPeriod: 'EMA of TSI used as the signal line.',
    },
    outputs: {
      Value: 'The TSI line.',
      Signal: 'An EMA of TSI.',
    },
  },
};
