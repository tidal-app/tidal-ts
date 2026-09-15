import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The columnar substrate is the point, not an optimisation.
 *
 * pond stores a series as packed typed arrays. `toObjects()`, `toRows()` and
 * `series.events` are the row-shaped doors out of that — and `toObjects()` is
 * literally `this.events`, so taking one materialises a JS object per bar and
 * hands back the row-shaped world the columnar store exists to replace. In a
 * profile it surfaces as `toEvents()`.
 *
 * That is not a slow path to use sparingly; it is opting out of the substrate.
 * Measured on 250,291 rows: 128 ms and 81 MB for a single `toObjects()`, against
 * 0.11 ms and no allocation for the `at(i)` / `column(name)` equivalents. The
 * app this library came out of shipped three of these on its render path —
 * invisible at 250 daily bars, seconds of frozen UI at intraday scale.
 *
 * They are easy to reach for and read as innocuous, so this test makes the exit
 * **visible** rather than relying on anyone remembering. Taking one is still
 * allowed — it is sometimes genuinely right, e.g. rendering a bounded page of
 * rows in a table — but it must be marked and justified:
 *
 * ```ts
 * // columnar-exempt: a 50-row page for the data table, already sliced.
 * const rows = page.toObjects();
 * ```
 *
 * Prefer, in order: `series.column(name)` for values, `series.at(i)` for one row
 * (pond documents it as O(1) via the per-row cache, unlike indexing `.events`),
 * and `slice(...)` first if a bounded window really is needed.
 */

const ROW_SHAPED = /\.(toObjects|toRows|toPoints)\(|\.events\b/;
const EXEMPT = 'columnar-exempt:';
const ROOT = join(__dirname, '..', 'packages');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so prose *about* these methods never trips the check — this
 *  file's own docblock would otherwise fail it. */
function codeLines(text: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let inBlock = false;
  text.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    const block = line.indexOf('/*');
    if (block !== -1) {
      const end = line.indexOf('*/', block);
      if (end === -1) {
        inBlock = true;
        line = line.slice(0, block);
      } else line = line.slice(0, block) + line.slice(end + 2);
    }
    const slash = line.indexOf('//');
    if (slash !== -1) line = line.slice(0, slash);
    if (line.trim()) out.push({ line, n: i + 1 });
  });
  return out;
}

describe('columnar discipline', () => {
  it('no unmarked row-shaped reads of a series', () => {
    const offences: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (!ROW_SHAPED.test(text)) continue;
      const lines = text.split('\n');
      for (const { line, n } of codeLines(text)) {
        if (!ROW_SHAPED.test(line)) continue;
        // The exemption may sit on the line or the two above it.
        const nearby = [lines[n - 1], lines[n - 2], lines[n - 3]].join('\n');
        if (nearby.includes(EXEMPT)) continue;
        offences.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
      }
    }
    expect(
      offences,
      `Row-shaped read of a pond series — this materialises one object per bar and\n` +
        `leaves the columnar substrate (see this file's docblock). Use column()/at(),\n` +
        `or mark it: // ${EXEMPT} <why>\n\n${offences.join('\n')}\n`,
    ).toEqual([]);
  });
});
