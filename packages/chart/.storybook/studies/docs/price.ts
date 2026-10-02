import type { StudyDoc } from '../types.js';

export const PRICE: Readonly<Record<string, StudyDoc>> = {
  typicalPrice: {
    name: 'Typical Price',
    what: 'The average of the high, low and close: (high + low + close) ÷ 3. A one-number summary of a bar.',
    uses: [
      'Smoother than the close alone, so useful as the input to another study (for example an SMA of typical price).',
      'It is the price that VWAP, the Money Flow Index, the Commodity Channel Index and Keltner Channels are built on.',
    ],
  },
  medianPrice: {
    name: 'Median Price',
    what: 'The midpoint of the bar’s range: (high + low) ÷ 2. It ignores where the bar opened or closed.',
    uses: [
      'Used where the range matters more than the close, for example by the Awesome Oscillator.',
      'A smoother input to moving averages than the close.',
    ],
  },
  weightedClose: {
    name: 'Weighted Close',
    what: 'The average of the high, low and the close counted twice: (high + low + 2 × close) ÷ 4. It leans toward where the bar settled.',
    uses: ['An input to other studies when you want a bar summary that still favours the close.'],
  },
  averagePrice: {
    name: 'Average Price (OHLC/4)',
    what: 'The plain average of the open, high, low and close.',
    uses: [
      'The most even-handed one-number summary of a bar, as an input to other studies.',
      'It is the close used by Heikin-Ashi candles.',
    ],
  },
};
