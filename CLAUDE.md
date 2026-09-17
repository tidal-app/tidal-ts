# tidal-ts — agent notes

For AI agents working on this repo. Owner: Peter Murphy.

**This repo is PUBLIC.** It was cut out of a private application whose first
consumers work at one company. That company's stack — its products, services,
hosts, internal documents, field names — is **never named here**, in code,
comments, docs, commit messages, issues or PRs. `pnpm verify` runs a vocabulary
gate (`scripts/check-vocabulary.sh`); if it fires, rewrite the sentence
generically ("the market-data backend we consume"), never widen the gate.

## What this is

Three packages on one version, released together, mirroring the pond-ts
family: `@tidal-ts/core` (the domain seam: studies, vol schema, windows,
columnar adapter, sessions, time zones), `@tidal-ts/chart` (`TimeSeriesChart`
and its vocabulary, the prepare step) and `@tidal-ts/terminal` (the
configuration statechart). Dependency direction is one-way: `terminal → chart
→ core`.

## Rules that shape the code

- **The stories are the proof, not decoration.** `pnpm storybook` hosts the
  chart from a literal theme with no provider and no stylesheet; a story that
  needs either is the boundary breaking.
- **The chart reads no token, no provider, no storage.** Theme, colour
  resolution and settings arrive as props (`packages/chart/src/boundary.test.ts`
  enforces the folder's imports). A host owns the look; the chart owns the
  drawing.
- **The machine owns configuration, never data.** No fetch, no series, no
  transport in `@tidal-ts/terminal`. What the host must supply (catalog,
  storage, palette, inspector) is `TerminalInput` / the provider's props.
- **Stay columnar.** `test/columnarDiscipline.test.ts` fails on an unmarked
  `toObjects()` / `toRows()` / `.events` read; `series.column()` / `at(i)` are
  the readers. Mark a deliberate exit with `// columnar-exempt: <why>`.
- **Push the library, don't route around it.** A rough edge in pond-ts or
  `@pond-ts/charts` is recorded (generically) and relayed upstream by Peter;
  a silent workaround is not acceptable without that record.
- **Pin exact while pre-1.0.** `@pond-ts/process` is pinned exact; consumers
  are told to pin this family exact too.

## Process

Meaningful changes land via PR with a fresh adversarial agent review before
merge (post findings on the PR, respond, then Peter merges). Identify as
"tidal agent" when posting. Commits carry the `Co-Authored-By` trailer.
Releases: bump every package together, CHANGELOG entry, tag `vX.Y.Z` — and a
NEW package's first version is published by hand (RELEASING.md).
