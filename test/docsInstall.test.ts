import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The docs site's install command names the pond versions, because a bare
 * `npm install pond-ts` takes the newest release and npm then refuses it
 * against this family's older peer range. So the command has to move with the
 * peers: this fails when a release changes a pond peer and the docs still name
 * the old one.
 */
const ROOT = join(__dirname, '..');
const page = readFileSync(join(ROOT, 'website/docs/getting-started.mdx'), 'utf8');
const peers: Record<string, string> = {};
for (const p of ['core', 'chart']) {
  const pkg = JSON.parse(readFileSync(join(ROOT, `packages/${p}/package.json`), 'utf8'));
  Object.assign(peers, pkg.peerDependencies);
}
const pond = Object.entries(peers).filter(([name]) => /^(pond-ts|@pond-ts\/)/.test(name));
/** `{ name: spec }` for every `name@spec` the page's npm commands install. */
const named = Object.fromEntries(
  [...page.matchAll(/(?:^|\s)((?:@[\w-]+\/)?[\w-]+)@([~^]?[\d.]+)/gm)].map((m) => [m[1]!, m[2]!]),
);

describe('the getting started install command', () => {
  it('reads the peers (the test is not vacuous)', () => {
    expect(pond.length).toBeGreaterThan(3);
  });

  it.each(pond)('names %s at the version the packages ask for', (name, range) => {
    const spec = named[name];
    expect(spec, `${name} is not named in the install command`).toBeDefined();
    // `^0.70.0` on a 0.x line means 0.70.x, which `~0.70.0` installs; an exact
    // peer must be installed exactly.
    const expected = range.startsWith('^0.') ? `~${range.slice(1)}` : range;
    expect(spec).toBe(expected);
  });
});
