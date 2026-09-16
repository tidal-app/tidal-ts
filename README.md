# tidal-ts

A financial time-series charting library on the [pond-ts](https://pond-ts.org)
constellation: a multi-row chart, the vocabulary that configures it, a
content-addressed study seam, and a statechart that owns a chart's configuration.

Cut out of [Tidal](https://github.com/tidal-app/tidal), a volatility analytics
terminal, so that other applications can render the same chart without Tidal's
control panel or data layer. **Pre-1.0 — pin an exact version.**

| package              | what                                                                                                                         | peers                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `@tidal-ts/core`     | studies and derive specs on `@pond-ts/process`, the vol schema, bar windows, the columnar wire adapter, sessions, time zones | `pond-ts`, `@pond-ts/financial`, `@pond-ts/process`       |
| `@tidal-ts/chart`    | `TimeSeriesChart`, `SeriesConfig` and the axis vocabulary, chart settings, the prepare step                                  | React, `@pond-ts/charts`, `pond-ts`, `@pond-ts/financial` |
| `@tidal-ts/terminal` | the terminal machine (XState v5): rows, series, studies, pairs, axes, presets — config only                                  | React, `xstate`, `@xstate/react`                          |

The pond family is a **peer dependency**: one copy of `pond-ts` per bundle, on
one version, or series identity breaks silently. Install the same version of
every pond package your app already uses.

## The shape

```ts
import { TimeSeriesChart, prepareChart, type SeriesConfig } from '@tidal-ts/chart';
import { deriveId, snapshotToTimeSeries, type DeriveSpec } from '@tidal-ts/core';

// 1. Your adapter turns your wire format into pond TimeSeries.
const price = snapshotToTimeSeries(snapshot);

// 2. Your UI builds configs: what to draw, in which colour, on which axis.
//    A colour is whatever your `resolveColor` understands — a palette key or CSS.
const sma: DeriveSpec = { op: 'sma', inputs: ['close'], params: { period: 20 } };
const configs: SeriesConfig[] = [
  { id: 's-1', column: 'close', label: 'Close', color: '#7c9cff', axis: 'L', style: 'line', visible: true, value: null, source: 'price' },
  { id: 's-2', column: deriveId(sma), derive: sma, label: 'SMA 20', color: '#f0a93f', axis: 'L', style: 'line', visible: true, value: null, source: 'price' },
];

// 3. The prepare step folds the studies and values the rows.
const { rows, sources } = prepareChart({ price: { series: price } }, [{ id: 'main', configs }]);

// 4. The chart takes its theme (a @pond-ts/charts ChartTheme) as a prop.
<TimeSeriesChart rows={rows.map((r) => ({ ...r, height: 400 }))} sources={sources} theme={theme} />;
```

`theme` is a `ChartTheme` from `@pond-ts/charts` — build it from your design
tokens with `cssVarTheme`, or write it as a literal. `resolveColor` maps a
config's colour to a canvas colour when your configs carry palette keys rather
than CSS colours; `colorScheme` says which way a hovered axis lifts.

## Developing

Node 22, pnpm 11.

```
pnpm install
pnpm verify      # format · vocabulary gate · typecheck · test · build
```

`pnpm verify` includes a **vocabulary gate**: this is a public repo, and the
stack of the company its first consumers work for is never named in it. Say
what the library needs; keep the measurements; drop the names.

Rough edges in pond-ts or `@pond-ts/charts` found while working here are
recorded in Tidal's friction log and relayed upstream from there.

## Releasing

All packages ship on one version. See [RELEASING.md](RELEASING.md) — in short:
bump every `packages/*/package.json` together, add a CHANGELOG entry, tag
`vX.Y.Z` and push the tag; the Release workflow publishes with provenance
through npm trusted publishing (no stored token). **A new package's first
version is published by hand**, because the trusted-publisher link can only be
made on a package that already exists.

MIT.
