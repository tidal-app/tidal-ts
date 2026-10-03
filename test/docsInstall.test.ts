import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The install commands in the docs name the pond versions, because a bare
 * `npm install pond-ts` takes the newest release and npm then refuses it
 * against this family's older peer range. So each command has to move with
 * the peers: this fails when a release changes a pond peer and a page still
 * names the old one, or stops naming one the package needs.
 */
const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const pondPeers = (...pkgs: string[]): [string, string][] => {
  const peers: Record<string, string> = {};
  for (const p of pkgs)
    Object.assign(peers, JSON.parse(read(`packages/${p}/package.json`)).peerDependencies);
  return Object.entries(peers).filter(([name]) => /^(pond-ts|@pond-ts\/)/.test(name));
};

/** Each page, and the packages whose pond peers its install command must name. */
const PAGES: [string, string[]][] = [
  ['website/docs/getting-started.mdx', ['core', 'chart']],
  ['packages/core/README.md', ['core']],
  ['packages/chart/README.md', ['core', 'chart']],
];

/** `^0.70.0` on a 0.x line means 0.70.x, which `~0.70.0` installs; an exact
 *  peer must be installed exactly. */
const installSpec = (range: string) => (range.startsWith('^0.') ? `~${range.slice(1)}` : range);

describe.each(PAGES)('the install command in %s', (path, pkgs) => {
  const named = Object.fromEntries(
    [...read(path).matchAll(/(?:^|\s)((?:@[\w-]+\/)?[\w-]+)@([~^]?[\d.]+)/gm)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
  const peers = pondPeers(...pkgs);

  it('reads the peers (the test is not vacuous)', () => {
    expect(peers.length).toBeGreaterThan(1);
  });

  it.each(peers)('names %s at the version the packages ask for', (name, range) => {
    expect(named[name], `${name} is not named in the install command`).toBe(installSpec(range));
  });
});
