#!/usr/bin/env bash
# This is a PUBLIC package. The stack of the company its first consumers work
# for must not be named here — not a product, a service, a host, a document.
# Say "the market-data backend we consume"; keep the measurements, drop the
# names. Part of `pnpm verify`, so the gate holds on every push.
set -euo pipefail
pattern='spiderrock|\bwts\b|mlink|hlink|\bmars\b|ignite|web-platform|srse|\bvenus\b|\bsaturn\b'
if grep -rniE "$pattern" packages/*/src README.md CHANGELOG.md CLAUDE.md test scripts/*.sh --exclude=check-vocabulary.sh; then
  echo "vocabulary gate: the lines above name an employer's stack" >&2
  exit 1
fi
echo "vocabulary gate: clean"
