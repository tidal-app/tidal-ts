# Releasing

All packages ship on **one version**, together, like the pond-ts family.

## Every release

1. Bump the `version` in every `packages/*/package.json` to the same value.
2. Add the entry to `CHANGELOG.md`.
3. `pnpm verify`, then merge to `main` via PR.
4. Tag and push the tag:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   The Release workflow checks that the tag matches every package version and
   sits on `main`, runs verify, and publishes each package that the registry
   does not already have — in dependency order (core, chart, terminal), with
   provenance, through **npm trusted publishing**. No token is stored anywhere.
   (pnpm packs — it rewrites `workspace:*` — and the npm CLI publishes: it is
   the reference client for trusted publishing, and pnpm 11's own OIDC exchange
   was refused by the registry on the first attempt.)

## A NEW package's first version is published by hand

Trusted publishing is a link between an npm package and a GitHub workflow, made
on npmjs.com under the package's settings. It cannot be made before the package
exists — so the first version of every new package is pushed from a logged-in
machine, once. (pond-ts went through this for each package it added; it is the
step that is easy to forget until CI fails with a 404.)

From a checkout of `main` at the release commit:

```bash
npm login                                   # once per machine; 2FA prompt
pnpm install && pnpm verify
pnpm -r publish --access public --no-git-checks
```

`pnpm -r publish` walks the workspace in dependency order and rewrites every
`workspace:*` to the concrete version. Then, on npmjs.com, for **each** new
package: _Settings → Publishing access → Trusted publisher → GitHub Actions_,
with organisation `tidal-app`, repository `tidal-ts`, workflow `release.yml`.
Optionally set publishing access to "require trusted publishing" so a leaked
token could never publish.

Finally tag the commit and push the tag. The workflow sees each version is
already on the registry and skips it — the tag is the record, and the workflow
run proves the link works before the next release depends on it.

## Checking a release

```bash
npm view @tidal-ts/core version
npm view @tidal-ts/chart dependencies     # must name @tidal-ts/core at the exact version
```
