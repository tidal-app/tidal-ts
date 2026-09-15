# Changelog

All packages release together on one version.

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
