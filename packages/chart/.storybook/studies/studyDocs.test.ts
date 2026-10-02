import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { opOutputs, opParams, studyCatalog } from '@tidal-ts/core';

import { STUDY_DOCS } from './docs/index.js';
import { FAMILIES } from './families.js';

/**
 * The study catalog covers the study menu exactly — no study offered without
 * a page, no page for a study that is not offered, and no page describing a
 * setting or an output the study does not have.
 *
 * The menu is generated from the registry, so a study adopted upstream lands
 * in the product with no edit here. This is what makes it land in the docs
 * too: the adoption fails this test until someone writes its page.
 */
const catalog = studyCatalog();
const ops = catalog.map((s) => s.op as string);
const STORIES = join(__dirname, '../../src/studies');

/** `{ exportName: op }` for every story a stories file declares. */
const storiesIn = (text: string): Record<string, string> =>
  Object.fromEntries(
    [...text.matchAll(/^export const (\w+): Story = \{[\s\S]*?op: '(\w+)'/gm)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );

describe('the study catalog docs', () => {
  it('is looking at the menu (the test is not vacuous)', () => {
    expect(ops.length).toBeGreaterThan(50);
    expect(ops).toContain('rsi');
  });

  it('has a page for every study the menu offers, and none it does not', () => {
    expect(ops.filter((op) => !STUDY_DOCS[op])).toEqual([]);
    expect(Object.keys(STUDY_DOCS).filter((op) => !ops.includes(op))).toEqual([]);
  });

  it.each(ops)('%s describes exactly the params it declares', (op) => {
    const declared = opParams(op)
      .map((p) => p.name)
      .sort();
    expect(Object.keys(STUDY_DOCS[op]?.params ?? {}).sort()).toEqual(declared);
  });

  it.each(ops)('%s names every output when it has more than one', (op) => {
    const outs = opOutputs(op);
    const described = Object.keys(STUDY_DOCS[op]?.outputs ?? {}).sort();
    expect(described).toEqual(outs.length > 1 ? [...outs].sort() : []);
  });

  it('gives every menu family a section', () => {
    const families = [...new Set(catalog.map((s) => s.family))].sort();
    expect(FAMILIES.map((f) => f.family as string).sort()).toEqual(families);
  });

  it('puts every study on one story, in its own family’s file', () => {
    const files = readdirSync(STORIES).filter((f) => f.endsWith('.stories.tsx'));
    const seen: string[] = [];
    for (const f of FAMILIES) {
      const file = files.find((name) =>
        readFileSync(join(STORIES, name), 'utf8').includes(`title: '${f.title}'`),
      );
      expect(file, f.title).toBeDefined();
      const stories = storiesIn(readFileSync(join(STORIES, file!), 'utf8'));
      const expected = catalog.filter((s) => s.family === f.family).map((s) => s.op as string);
      expect(Object.values(stories).sort()).toEqual([...expected].sort());
      // The export name is the op in PascalCase — the overview builds its
      // links from that, so a renamed export would be a dead link.
      for (const [name, op] of Object.entries(stories)) {
        expect(name).toBe(op.charAt(0).toUpperCase() + op.slice(1));
      }
      seen.push(...Object.values(stories));
    }
    expect(seen.sort()).toEqual([...ops].sort());
  });
});
