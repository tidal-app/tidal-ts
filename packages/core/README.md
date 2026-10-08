# @tidal-ts/core

The part of [tidal-ts](https://github.com/tidal-app/tidal-ts) with no drawing in
it: the technical studies, the volatility data layout, bar windows, the adapter
for a column-by-column wire format, trading sessions and time zones. Built on
[pond-ts](https://pond-ts.org).

**Pre-1.0: pin an exact version.** Every `@tidal-ts/*` package ships on one
version number.

- [Docs](https://tidal-app.github.io/tidal-ts/docs/packages/core/)
- [Study catalog](https://tidal-app.github.io/tidal-ts/docs/studies/): every study with a live chart, its
  settings, and how traders use it

## Install

```bash
npm install --save-exact @tidal-ts/core @pond-ts/process@0.72.0
npm install pond-ts@~0.72.0 @pond-ts/financial@~0.72.0
```

The pond packages are peer dependencies: install them once, on the version
this release names in its `peerDependencies`, so there is only one copy of
pond-ts in your bundle.

## A study is data

```ts
import { applyDerived, deriveId, type DeriveSpec } from '@tidal-ts/core';

const rsi: DeriveSpec = { op: 'rsi', inputs: ['close'], params: { period: 14 } };

// Compute it onto a pond TimeSeries of bars; the values land in this column.
const withRsi = applyDerived(series, [rsi]);
const column = deriveId(rsi);
```

`studyCatalog()` lists every study on offer, and `opParams`, `opOutputs` and
`studyLevels` describe each one's settings, outputs and guide lines.

To draw it, see [`@tidal-ts/chart`](https://www.npmjs.com/package/@tidal-ts/chart).

MIT.
