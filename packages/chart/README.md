# @tidal-ts/chart

`TimeSeriesChart`: a multi-row financial time-series chart for React, built on
[`@pond-ts/charts`](https://pond-ts.org/docs/charts). Rows stack on one shared
time axis; each holds candles, lines, bands, bars and technical studies on a
left and a right axis. Part of [tidal-ts](https://github.com/tidal-app/tidal-ts).

The chart reads no CSS, no context provider and no storage. Its theme, colours
and settings arrive as props, so it takes on your app's design system.

**Pre-1.0: pin an exact version.** Every `@tidal-ts/*` package ships on one
version number.

- [Getting started](https://tidal-app.github.io/tidal-ts/docs/getting-started/): install, then candles, a moving
  average and an RSI panel
- [Docs](https://tidal-app.github.io/tidal-ts/docs/packages/chart/)
- [Study catalog](https://tidal-app.github.io/tidal-ts/docs/studies/)
- [Storybook](https://tidal-app.github.io/tidal-ts/storybook/)

## Install

```bash
npm install --save-exact @tidal-ts/core @tidal-ts/chart @pond-ts/process@0.72.0
npm install pond-ts@~0.72.0 @pond-ts/financial@~0.72.0 @pond-ts/charts@~0.72.0 @pond-ts/react@~0.72.0
```

React 18 or 19. The pond packages are peer dependencies: install them once, on
the version this release names in its `peerDependencies`, so there is only one
copy of pond-ts in your bundle.

## The shape

```tsx
import { prepareChart, TimeSeriesChart, type SeriesConfig } from '@tidal-ts/chart';
import { deriveId, type DeriveSpec } from '@tidal-ts/core';

const sma: DeriveSpec = { op: 'sma', inputs: ['close'], params: { period: 20 } };
const base = { axis: 'L', visible: true, value: null, unit: '', source: 'price' } as const;
const configs: SeriesConfig[] = [
  { ...base, id: 'price', column: 'close', label: 'Price', color: '#8b93a8', style: 'candle' },
  {
    ...base,
    id: 'sma',
    column: deriveId(sma),
    derive: sma,
    label: 'SMA 20',
    color: '#f0a93f',
    style: 'line',
  },
];

// The prepare step computes the studies and seats each config on its row.
const { rows, sources } = prepareChart({ price: { series } }, [{ id: 'main', configs }]);

<TimeSeriesChart
  rows={rows.map((r) => ({ ...r, height: 400 }))}
  sources={sources}
  ohlcSources={['price']}
  theme={theme} // a ChartTheme from @pond-ts/charts
/>;
```

MIT.
