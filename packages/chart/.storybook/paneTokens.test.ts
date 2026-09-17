import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PANE_DARK, PANE_LIGHT, PANE_TOKENS } from './preview.js';

/**
 * Every `--pane-*` an atom paints with is defined by BOTH schemes.
 *
 * This exists because the opposite shipped: `paneAtoms.tsx` read eleven custom
 * properties, its own comment said the preview decorator set them, and the
 * decorator set none — so the consumer pane rendered with transparent grounds
 * and inherited ink, silently, because an undefined custom property is not an
 * error. Nothing failed; it just looked wrong to anyone who opened it.
 *
 * The type system cannot hold this line. A style object carrying custom
 * properties has to be cast to `CSSProperties` to be assignable at all, and the
 * cast takes excess-property checking with it — so a typo'd token name
 * typechecks clean and paints nothing. A grep is the check that actually binds.
 */
const atoms = readFileSync(join(__dirname, 'paneAtoms.tsx'), 'utf8');

/** Every `var(--pane-…)` the atoms name, deduped. */
const read = [...new Set([...atoms.matchAll(/var\((--pane-[a-z-]+)\)/g)].map((m) => m[1]!))].sort();

describe('the workshop pane defines the tokens it paints with', () => {
  it('is looking at the atoms (the test is not vacuous)', () => {
    // A moved file or a broken pattern would make every assertion below pass
    // over an empty list.
    expect(read.length).toBeGreaterThan(5);
    expect(read).toContain('--pane-surface');
  });

  it.each(['dark', 'light'] as const)('%s defines every token an atom reads', (scheme) => {
    const defined = scheme === 'dark' ? PANE_DARK : PANE_LIGHT;
    const missing = read.filter((token) => !(token in defined));
    expect(missing).toEqual([]);
  });

  it('declares no token no atom reads', () => {
    // The other direction: a token nobody paints with is either a rename that
    // left its old name behind, or a colour decision with no consequence.
    expect(PANE_TOKENS.filter((token) => !read.includes(token))).toEqual([]);
  });

  it('keeps the two schemes on the same keys', () => {
    expect(Object.keys(PANE_LIGHT).sort()).toEqual(Object.keys(PANE_DARK).sort());
  });
});
