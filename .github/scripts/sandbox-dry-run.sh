#!/bin/sh
# A real, sandboxed run of the Factory through the swamp CLI (#52): render the
# example app spec into a throwaway app checkout, run the drafted app's own
# tests, and check the Stagecraft definition's saved scenarios. Nothing is
# pushed or published, and the Factory checkout is left as it was.
# Usage: .github/scripts/sandbox-dry-run.sh   (from the Factory checkout)
set -eu
factory=$(pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
repo=https://github.com/example/obsidian-puddle-scanner
before=$(git -C "$factory" status --porcelain)

echo "==> a swamp repo with the Factory as a local source"
mkdir "$work/swamp" && cd "$work/swamp"
git init -q && swamp repo init --json > /dev/null
swamp extension source add "$factory" --json > /dev/null
swamp extension trust add puddleworks --json > /dev/null
swamp behavior create @puddleworks/puddleworks-factory/draft puddleworks-factory \
  --json > /dev/null

echo "==> a throwaway checkout of the app repo, on its draft branch"
app="$work/obsidian-puddle-scanner"
mkdir "$app" && git -C "$app" init -q -b draft/obsidian-puddle-scanner
git -C "$app" remote add origin "$repo.git"
(cd "$app" && swamp repo init --json > /dev/null)

echo "==> render the approved spec"
spec="$factory/docs/contracts/app-spec.v1.example.json"
swamp behavior run puddleworks-factory render \
  --input spec="$spec" --input targetDir="$app" --input repository="$repo" \
  --input branch=draft/obsidian-puddle-scanner \
  --input specDigest="$(sha256sum "$spec" | cut -d' ' -f1)" --json > "$work/render.json"
jq -r .status "$work/render.json"
test -f "$app/manifest.yaml"

echo "==> a changed spec writes nothing"
sed 's/Obsidian/Obsidian /' "$spec" > "$work/changed.json"
files() { (cd "$app" && find . -path ./.git -prune -o -path ./.swamp -prune -o -type f -print | sort | xargs sha256sum); }
was=$(files)
if swamp behavior run puddleworks-factory render \
  --input spec="$work/changed.json" --input targetDir="$app" \
  --input repository="$repo" --input overwrite=true \
  --input specDigest="$(sha256sum "$spec" | cut -d' ' -f1)" --json \
  > "$work/changed.out" 2>&1; then
  echo "rendered a spec that was not the approved one" >&2
  exit 1
fi
grep -q "has changed since it was approved" "$work/changed.out"
test "$(files)" = "$was"

echo "==> the drafted app's own tests"
# The template, not render, supplies the Makefile, so run swamp's deno.
deno=$(swamp doctor extensions --json | jq -r .denoPath)
(cd "$app" && "$deno" test -A extensions/models/)

echo "==> the Stagecraft definition and its saved scenarios"
swamp extension pull @swamp/stagecraft@2026.11.11.1 --json > /dev/null
swamp behavior create @swamp/stagecraft/tracker board --global-arg prefix=fb --json > /dev/null
swamp behavior create @swamp/stagecraft/factory fb --global-arg tracker=board --json > /dev/null
f=models/@swamp/stagecraft/factory/fb.yaml
{
  grep -v '^globalArguments:\|^  tracker:\|^methods:' "$f"
  echo 'globalArguments:'
  echo '  tracker: board'
  sed 's/^/  /' "$factory/docs/stagecraft/factory-build.yaml"
  echo 'methods: {}'
} > "$work/fb.yaml" && mv "$work/fb.yaml" "$f"
swamp behavior run fb validate > "$work/validate.out" 2>&1 || { tail -20 "$work/validate.out" >&2; exit 1; }
grep "factory 'fb' is valid" "$work/validate.out"

test "$(git -C "$factory" status --porcelain)" = "$before" ||
  { echo "the Factory checkout changed" >&2; exit 1; }
echo "sandbox dry run: ok"
