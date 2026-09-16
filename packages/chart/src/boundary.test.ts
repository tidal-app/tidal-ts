import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The chart entry's dependency boundary — the split that lets this folder
 * become `@tidal-ts/chart` (TDL-LIB phase 1). Enforced rather than remembered,
 * the way `columnarDiscipline.test.ts` enforces the columnar rule: a control-
 * panel import that creeps in here is a library that cannot be published.
 *
 * Allowed: `@tidal-ts/core`, the pond family, React, and this folder's own files.
 * Not allowed: anything up a directory (`../`), any CSS, any other package.
 * Stories are exempt — they are the workshop, and they HOST the chart with
 * Tidal's theme provider on purpose, exactly as the app does.
 */
const ALLOWED = [/^react$/, /^pond-ts$/, /^@pond-ts\//, /^@tidal-ts\/core$/, /^\.\/[^/]+\.js$/];

/** Comments stripped: a doc that SAYS "the host reads `--td-*`" is the seam
 *  being explained, not crossed. Only code counts. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sources = () =>
  readdirSync(__dirname)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|stories)\.tsx?$/.test(f))
    .map((f) => ({ file: f, text: code(readFileSync(join(__dirname, f), 'utf8')) }));

/** Every module specifier a file names: static `from`, side-effect `import`,
 *  dynamic `import()` and `require()` — a dynamic import is still a dependency. */
const specifiers = (text: string): string[] => [
  ...[...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!),
  ...[...text.matchAll(/^import\s+'([^']+)'/gm)].map((m) => m[1]!),
  ...[...text.matchAll(/\b(?:import|require)\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]!),
];

describe('the chart entry stays publishable', () => {
  it('is looking at the chart entry (the test is not vacuous)', () => {
    // If the folder moves or the glob breaks, an empty scan would pass every
    // assertion below. The renderer is the one file that must be here.
    expect(sources().map((s) => s.file)).toContain('TimeSeriesChart.tsx');
  });

  it('imports only core, the pond family, React and itself', () => {
    const offenders = sources().flatMap(({ file, text }) =>
      specifiers(text)
        .filter((spec) => !ALLOWED.some((rule) => rule.test(spec)))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no CSS side effect — a host styles the page, the chart is styled by props', () => {
    const css = sources().flatMap(({ file, text }) =>
      specifiers(text)
        .filter((spec) => spec.endsWith('.css'))
        .map((spec) => `${file}: ${spec}`),
    );
    expect(css).toEqual([]);
  });

  it('reads no token and no provider: the theme, colours and settings arrive as props', () => {
    const leaks = sources().flatMap(({ file, text }) =>
      ['getComputedStyle', '--td-', 'useTheme(', 'useChartSettings(', 'localStorage']
        .filter((needle) => text.includes(needle))
        .map((needle) => `${file}: ${needle}`),
    );
    expect(leaks).toEqual([]);
  });
});
