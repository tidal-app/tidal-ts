#!/usr/bin/env bash
# This is a PUBLIC package. The stack of the company its first consumers work
# for must not be named here — not a product, a service, a host, a document,
# and not its data dictionary either: a dataset or column name that is only
# searchable because one vendor publishes it identifies the vendor as surely as
# its name does. Say "the market-data backend we consume" / "the feed's daily
# history"; keep the measurements, drop the identifiers. Part of `pnpm verify`.
#
# The gate is a regex and will miss what it has not been taught. When a review
# finds a leak, rewrite the prose AND add the identifier here.
set -euo pipefail
names='spiderrock|\bwts\b|mlink|hlink|\bmars\b|\bignite\b|web-platform|srse|\bvenus\b|\bsaturn\b'
schema='atmCen|HistoricalVolatilities|TickerHistory|LiveAtmStream|OptionRoot|\bekey\b|\bdsets?\b|nEarnCnt|expiryCount'
private='datasources\.md|wts-handoff|control-panel\.md|state-architecture\.md|docs/(plans|notes)/|TDL_[A-Z]+|the desk'
pattern="$names|$schema|$private"
# `.storybook` is in the sweep too: the workshop is published prose (a story's
# doc block renders in Docs) and its files are as public as `src`. It was
# outside the sweep until a review pointed out that ~45 lines of new prose
# had landed in an ungated file (PR #9).
if grep -rniE "$pattern" packages/*/src packages/*/.storybook packages/*/package.json README.md CHANGELOG.md CLAUDE.md test .github scripts --exclude=check-vocabulary.sh; then
  echo "vocabulary gate: the lines above identify an employer's stack" >&2
  exit 1
fi
echo "vocabulary gate: clean"
