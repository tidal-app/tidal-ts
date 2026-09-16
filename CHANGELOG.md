# Changelog

All packages release together on one version.

## 0.1.1 — 2026-09-16

First release through npm trusted publishing (OIDC, no stored token).

- `@tidal-ts/terminal` exports its **axis policy** (`canAddUnit` and friends):
  the predicates a host's menus gate on, the same ones the machine's guards
  enforce. 0.1.0 left them internal, so the first host had to keep its own
  copy to grey out an incompatible metric before the guard refused it.
- `@tidal-ts/chart` exports `hasBarOutput` — whether a config's study draws a
  bar output (a MACD's histogram), which a host's style controls gate on.
- `@tidal-ts/core`: version bump only (one version across the family).

## 0.1.0 — 2026-09-16

First publish, cut out of the Tidal application (`tidal-app/tidal`). **Pre-1.0:
pin an exact version.** The API is expected to move as the second consumer's
needs land.

- `@tidal-ts/core` — the derive/study seam on `@pond-ts/process` (specs,
  content-addressed ids, the fold, the study catalog adoption), the vol schema
  and fixtures, bar windows and auto-window, the columnar wire adapter, session
  and calendar helpers, the display/data time-zone split.
- `@tidal-ts/chart` — `TimeSeriesChart` (multi-row, shared time axis, on
  `@pond-ts/charts`), the series vocabulary (`SeriesConfig`, axis identity and
  ranges), the chart-settings vocabulary, and the prepare step (`foldSources`,
  `sourceFacts`, `assembleRows`, `prepareChart`). Theme, colour resolution and
  settings arrive as props; the package reads no CSS token and carries no CSS.
- `@tidal-ts/terminal` — the terminal statechart (XState v5): rows, series,
  studies, pairs, axis membership and ranges, presets. Config only, never data.
  The host injects its colour palette and, if it wants one, an inspector.
