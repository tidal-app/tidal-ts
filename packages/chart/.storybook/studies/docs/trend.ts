import type { StudyDoc } from '../types.js';

export const TREND: Readonly<Record<string, StudyDoc>> = {
  sma: {
    name: 'Simple Moving Average (SMA)',
    what: 'The plain average of the last N closes, recomputed every bar. Each bar in the window counts equally, so the line is smooth but slow: it turns only after the price has already turned.',
    uses: [
      'Trend direction: price above a rising SMA is read as an uptrend, below a falling one as a downtrend.',
      'Crossovers: a short SMA crossing above a long one (the 50-day over the 200-day is the famous "golden cross") is a classic buy signal; the reverse is a sell.',
      'Dynamic support and resistance: in a steady trend, pullbacks often stall near a widely watched average such as the 20, 50 or 200-day.',
      'A building block: many other studies smooth with it, and in Tidal you can take an SMA of any other study.',
    ],
    params: {
      period:
        'How many bars to average. Shorter follows price closely; longer is smoother and lags more.',
    },
  },
  ema: {
    name: 'Exponential Moving Average (EMA)',
    what: 'An average that weights recent bars more heavily than older ones, fading the past away gradually rather than dropping it off a cliff. It reacts to a turn sooner than an SMA of the same length.',
    uses: [
      'The same jobs as an SMA (trend direction, crossovers, support and resistance) when you want an earlier response.',
      'Short EMAs (8, 12, 21) are common for trading pullbacks inside a trend; the 12 and 26 are the halves of MACD.',
      'Two EMAs crossing is one of the simplest trend-following entry rules.',
    ],
    params: {
      period: 'The span of the average. The weight on the newest bar is 2 ÷ (period + 1).',
    },
  },
  bollinger: {
    name: 'Bollinger Bands',
    what: 'A moving average with a band above and below it, each a set number of standard deviations away. Because the band width comes from recent volatility, the bands widen when the market is moving hard and pinch together when it goes quiet.',
    uses: [
      'Volatility at a glance: very narrow bands (a "squeeze") often come before a large move, though not which way.',
      'Mean reversion: in a sideways market, touches of the outer band are faded back toward the middle.',
      'Trend strength: in a strong trend price can "walk the band", closing at or outside it bar after bar. That is strength, not an automatic sell.',
      'Two companion studies turn the bands into numbers: BandWidth (how wide) and %B (where price sits inside them).',
    ],
    params: {
      period: 'Bars in the moving average and in the standard deviation.',
      stdDev:
        'How many standard deviations the bands sit from the middle. 2 is the convention, and keeps most closes inside the bands.',
    },
    outputs: {
      Middle: 'The simple moving average.',
      Upper: 'Middle plus stdDev standard deviations.',
      Lower: 'Middle minus stdDev standard deviations.',
    },
  },
  directionalMovement: {
    name: 'Directional Movement Index (DMI / ADX)',
    what: "Wilder's system for separating trend direction from trend strength. +DI and −DI measure how much each bar pushed beyond the previous bar's high or low, as a share of the true range. ADX smooths how lopsided those two are into one strength reading that does not care which way the trend goes.",
    uses: [
      'Trend or no trend: ADX above about 25 is usually read as a trending market, below about 20 as a range. Many traders only use trend-following rules when ADX says there is a trend.',
      'Direction: +DI above −DI says buyers are in control, the reverse sellers. A crossover of the two is the classic entry signal.',
      'A rising ADX means the trend is strengthening, whichever way it points; a falling ADX from a high level often marks a trend running out of steam.',
    ],
    params: { period: 'The smoothing length used for every line. Wilder used 14.' },
    outputs: {
      PlusDi: '+DI: upward movement as a percent of true range.',
      MinusDi: '−DI: downward movement as a percent of true range.',
      Dx: 'DX: how one-sided the two DI lines are, 0 to 100. Noisy; ADX is its smoothed form.',
      Adx: 'ADX: smoothed DX, the trend-strength line most people mean by "ADX".',
      Adxr: "ADXR: the average of today's ADX and the ADX period − 1 bars earlier. Wilder used it to rank markets by how trending they were.",
    },
    note: 'All five lines share one panel. Most traders read just +DI, −DI and ADX together.',
  },
  aroon: {
    name: 'Aroon',
    what: 'Measures how long ago the highest high and the lowest low of the window happened, not how far away they are. Aroon Up is 100 when today made the window high and drifts down to 0 as that high ages; Aroon Down does the same for the low.',
    uses: [
      'Trend start: Aroon Up crossing above Aroon Down (and reaching toward 100) suggests a new uptrend; the reverse a downtrend.',
      'Trend health: in a strong uptrend Aroon Up stays near 100 because fresh highs keep printing.',
      'Consolidation: both lines low and close together means neither side is making new extremes.',
      'The oscillator (Up minus Down) folds the pair into one line that crosses zero at the turns.',
    ],
    params: {
      period: 'The look-back window, in bars, searched for the high and low. Chande used 25.',
    },
    outputs: {
      Up: 'Aroon Up, 0–100: how recent the highest high is.',
      Down: 'Aroon Down, 0–100: how recent the lowest low is.',
      Osc: 'Aroon Oscillator, −100 to 100: Up minus Down.',
    },
  },
  vortex: {
    name: 'Vortex Indicator',
    what: "Compares how far today's high reached above yesterday's low (upward movement) with how far today's low reached below yesterday's high (downward movement), each summed over the window and divided by the true range. Two lines result, +VI and −VI.",
    uses: [
      'Trend direction: +VI above −VI is read as an uptrend, the reverse as a downtrend.',
      'Entries on crossovers of the two lines, often confirmed by a break of the crossover bar’s high or low.',
      'Strength: the wider the gap between the lines, the more one-sided the trend.',
    ],
    params: {
      period:
        'The window the movements and true range are summed over. 14 is the published default.',
    },
    outputs: {
      Plus: '+VI: upward movement relative to true range.',
      Minus: '−VI: downward movement relative to true range.',
    },
    note: 'The guide line at 1 is the level both lines move around; the crossover between them is the signal.',
  },
  verticalHorizontalFilter: {
    name: 'Vertical Horizontal Filter (VHF)',
    what: 'Net movement divided by total movement over the window: the distance from the highest to the lowest close, divided by the sum of every bar-to-bar change. A market that went straight one way scores near 1; one that churned back and forth scores low.',
    uses: [
      'Choosing a playbook: when VHF is high and rising, use trend-following tools; when it is low, use range tools such as oscillators.',
      'A rising VHF warns that a range is turning into a trend.',
      'It says nothing about direction, so it is paired with a directional study.',
    ],
    params: { period: 'The window, in bars. White used 28.' },
  },
  randomWalkIndex: {
    name: 'Random Walk Index (RWI)',
    what: 'Asks whether the recent move was bigger than a random walk would produce. For every horizon up to the period it compares the move with the distance a coin-flip market would be expected to cover, and keeps the largest ratio. One line measures the up move, the other the down move.',
    uses: [
      'A reading above 1 says the move is larger than chance would explain, which is read as a real trend.',
      'Trend direction: RWI High above 1 with RWI Low below 1 is an uptrend, and the reverse a downtrend.',
      'Both lines below 1 means the market is wandering without a trend.',
    ],
    params: { period: 'The longest horizon tested, in bars.' },
    outputs: {
      High: 'RWI High: the strength of the up move.',
      Low: 'RWI Low: the strength of the down move.',
    },
    note: 'Either line can dip below zero when the market moved the other way across every horizon. That just means "no move in this direction".',
  },
  ichimoku: {
    name: 'Ichimoku Cloud (Ichimoku Kinko Hyo)',
    what: 'A five-line system meant to show trend, momentum and support or resistance in one view. Three lines are midpoints of the high-low range over 9, 26 and 52 bars; one is the average of the first two; and one is simply the close. The space between the two "leading span" lines is the cloud.',
    uses: [
      'Trend: price above the cloud is bullish, below is bearish, inside is undecided.',
      'Signals: the conversion line (Tenkan) crossing the base line (Kijun) is the most common entry trigger.',
      'Support and resistance: the cloud edges and the base line act as levels price often reacts to.',
      'A thick cloud is read as strong support or resistance, a thin one as weak.',
    ],
    params: {
      conversionPeriod:
        'Bars for the conversion line (Tenkan): the midpoint of the high-low range. Classic value 9.',
      basePeriod: 'Bars for the base line (Kijun). Classic value 26.',
      spanBPeriod: 'Bars for leading span B. Classic value 52.',
      displacement:
        'How many bars the classic chart shifts the cloud forward and the lagging line back. Recorded with the study, but see "Good to know": Tidal does not shift the lines yet, so changing this does not move anything.',
    },
    outputs: {
      Tenkan: 'Conversion line: the 9-bar high-low midpoint.',
      Kijun: 'Base line: the 26-bar high-low midpoint.',
      SenkouA: 'Leading span A: the average of the conversion and base lines.',
      SenkouB: 'Leading span B: the 52-bar high-low midpoint.',
      Chikou: 'Lagging span: the close.',
    },
    note: 'On a textbook Ichimoku chart the two leading spans are drawn 26 bars into the future and the lagging span 26 bars into the past. Here every line is drawn at the bar it was calculated on, so the cloud is not shifted and the lagging span sits exactly on the close. The values are correct; only the placement differs. The cloud is drawn as two lines rather than a filled area.',
  },
  elderRay: {
    name: 'Elder Ray (Bull and Bear Power)',
    what: "Measures how far each bar's high got above a 13-bar EMA of the close (bull power) and how far its low got below it (bear power). The EMA stands for the market's consensus value; the extremes show how hard buyers and sellers pushed away from it.",
    uses: [
      "Elder's buy setup: the EMA is rising and bear power is negative but climbing back toward zero (sellers are losing grip in an uptrend).",
      'His sell setup is the mirror: the EMA is falling and bull power is positive but shrinking.',
      'Divergence between price highs and bull-power highs warns that a rally is weakening.',
    ],
    params: { period: 'Length of the EMA used as the consensus price. Elder used 13.' },
    outputs: {
      Bull: 'Bull power: high minus the EMA.',
      Bear: 'Bear power: low minus the EMA.',
    },
  },
  trendIntensityIndex: {
    name: 'Trend Intensity Index (TII)',
    what: 'Takes how far price has been from its long moving average over recent bars and reports what share of that distance was above the average, as 0 to 100. 50 means price spent as much distance above the average as below it.',
    uses: [
      'Readings persistently above 80 point to a strong uptrend, below 20 a strong downtrend.',
      'Readings hovering around 50 mean there is no trend worth following.',
      'A move out of the middle zone can flag the start of a trend.',
    ],
    params: {
      period: 'How many recent bars of deviation are summed. Pee used 30, half the average length.',
      maPeriod: 'Length of the simple moving average that price is measured against. Pee used 60.',
    },
    note: 'Needs about period + maPeriod bars before its first value, so the line starts later than most.',
  },
  ravi: {
    name: 'Range Action Verification Index (RAVI)',
    what: 'The gap between a short and a long simple moving average, as a percentage of the long one, with the sign removed. It answers only "is there a trend?" and not which way.',
    uses: [
      "Chande's rule: above 3% the market is trending, below 3% it is ranging.",
      'Used as a filter so trend-following entries are only taken when RAVI says a trend is present.',
    ],
    params: {
      shortPeriod: 'The fast simple moving average. Chande used 7 (about a week of daily bars).',
      longPeriod: 'The slow simple moving average. Chande used 65 (about a quarter).',
    },
  },
  swingIndex: {
    name: 'Swing Index',
    what: "Wilder's attempt at the \"real\" price change of one bar. It blends today's close-to-close move with today's candle body and a quarter of yesterday's body, scaled by the bar's range and by how big the move was compared with the instrument's daily limit move. The result stays within −100 to +100 as long as the limit is at least as big as the largest move; with a smaller limit it can go beyond.",
    uses: [
      'Mostly used through its running total, the Accumulative Swing Index, which is easier to read.',
      'Positive values mean the bar swung up, negative down; large values mark strong bars.',
    ],
    params: {
      limit:
        "The instrument's limit move: the largest price change allowed in one session (a futures concept). There is no natural default for stocks; pick a value larger than the biggest daily move you expect. It scales the whole reading.",
    },
  },
  accumulativeSwingIndex: {
    name: 'Accumulative Swing Index (ASI)',
    what: 'The running total of the Swing Index. Wilder meant it as a cleaner version of the price line itself, with the noise of individual bars taken out.',
    uses: [
      'Draw trendlines on ASI rather than price: a break of an ASI trendline is read as a confirmed breakout.',
      'Confirmation: a new price high that ASI also confirms with a new high is a stronger signal.',
      'Divergence between price and ASI warns that a breakout may fail.',
    ],
    params: {
      limit:
        "The instrument's limit move (see Swing Index). It scales every bar's contribution, so it changes the line's size but not its shape.",
    },
  },
};
