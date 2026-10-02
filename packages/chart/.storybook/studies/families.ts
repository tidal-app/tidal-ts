/**
 * The catalog's sections — one per picker family, in reading order, so the
 * docs group studies exactly where Tidal's study menu does. `title` is the
 * Storybook title its stories file declares (the test holds the two equal).
 */
export const FAMILIES = [
  {
    family: 'trend',
    title: 'Studies/Trend',
    label: 'Trend',
    blurb:
      'Is there a trend, which way, and how strong? Moving averages and the classic trend systems.',
  },
  {
    family: 'momentum',
    title: 'Studies/Momentum',
    label: 'Momentum',
    blurb:
      'How fast price is moving and whether that speed is fading: the overbought / oversold oscillators.',
  },
  {
    family: 'moving-average',
    title: 'Studies/Moving-average oscillators',
    label: 'Moving-average oscillators',
    blurb:
      'Momentum read from the gap between moving averages, or from smoothed rates of change: MACD and its relatives.',
  },
  {
    family: 'bands',
    title: 'Studies/Bands and channels',
    label: 'Bands and channels',
    blurb:
      'Lines above and below price that mark how far is a normal move, and studies built from them.',
  },
  {
    family: 'volatility',
    title: 'Studies/Volatility',
    label: 'Volatility',
    blurb: 'How much the market is moving, regardless of direction.',
  },
  {
    family: 'volume',
    title: 'Studies/Volume',
    label: 'Volume',
    blurb: 'Whether trading activity is backing the price move: buying and selling pressure.',
  },
  {
    family: 'statistical',
    title: 'Studies/Statistical',
    label: 'Statistical',
    blurb: 'Plain statistics over a rolling window: regression, z-score, extremes and percentiles.',
  },
  {
    family: 'price',
    title: 'Studies/Price transforms',
    label: 'Price transforms',
    blurb: 'One-number summaries of a bar, mostly used as the input to another study.',
  },
] as const;

/** A story's id, the way Storybook derives it: the title and the export name,
 *  each lower-cased and hyphenated. Export names are the op in PascalCase. */
export const storyId = (title: string, op: string): string => {
  const kebab = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `${kebab(title)}--${kebab(op)}`;
};
