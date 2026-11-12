#!/bin/sh
# Drive a real Stagecraft work item on docs/stagecraft/factory-build.yaml
# through the swamp CLI (#47), for what saved scenarios can't show: the
# dispatch packets (generate's inputs reach render, code-review's prompt for
# rounds 1 and 2), a refused render and a dispatch retried past its cap, a
# rejected payload, a write from a stale view, two submits at once (only one
# goes through), interrupted dispatches, a gate a person never approved, and a
# third review that needs both Factory's grant and a cycle override. A refused
# write must leave the work item's run record as it was, except a dispatch past
# a cap, which journals the park, and a rejected payload, which is kept as
# feedback. Nothing is pushed or published, and the Factory checkout is left as
# it was.
#
# generate names Factory's build workflow, which swamp doesn't load from a
# local extension source, so this calls render with the packet's inputs, as
# sandbox-dry-run.sh does, and records the draft with a stand-in run id.
# Usage: .github/scripts/stagecraft-drive.sh   (from the Factory checkout)
set -eu
factory=$(pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
before=$(git -C "$factory" status --porcelain)
WI=@swamp/stagecraft/work-item
key=fb-1
repo=https://github.com/example/obsidian-puddle-scanner
branch=draft/obsidian-puddle-scanner
spec="$factory/docs/contracts/app-spec.v1.example.json"
digest=$(sha256sum "$spec" | cut -d' ' -f1)

fail() {
  echo "FAIL: $*" >&2
  { grep -E '^Error|not ready|at stage' "$work/last.out" || tail -15 "$work/last.out"; } >&2 2>/dev/null || true
  exit 1
}

# w METHOD [INPUT ...]: a write on the work item with the expectation the last
# write printed, which it then keeps. Fails with the output in last.out.
w() {
  m=$1
  shift
  # record_outcome and record_checkpoint name their dispatch, so they take no
  # expectation.
  case $m in record_outcome | record_checkpoint) ;; *) set -- "$@" $(cat "$work/expect") ;; esac
  for i; do set -- "$@" --input "$i"; shift; done
  if swamp behavior run "$WI" "$m" "$key" "$@" > "$work/last.out" 2>&1; then
    e=$(sed -n 's/^  expect: //p' "$work/last.out" | tail -1 | sed 's/--input //g')
    [ -z "$e" ] || echo "$e" > "$work/expect"
  else
    return 1
  fi
}
version() {
  swamp data query "modelName == \"$key\" && name == \"run\"" --json | jq -r '.results[0].version'
}
# refused TEXT METHOD [INPUT ...]: the write must fail naming TEXT and write
# nothing.
refused() {
  text=$1
  shift
  v=$(version)
  if w "$@"; then fail "$* was not refused"; fi
  grep -qF -- "$text" "$work/last.out" || fail "$* was refused without \"$text\""
  [ "$(version)" = "$v" ] || fail "$* was refused but wrote to the run"
}
# parks TEXT METHOD [INPUT ...]: a dispatch past a cap is refused naming TEXT,
# and the work item is parked: the park is journaled, so the run changes.
parks() {
  text=$1
  shift
  if w "$@"; then fail "$* was not refused"; fi
  grep -qF -- "$text" "$work/last.out" || fail "$* was refused without \"$text\""
  swamp behavior run "$WI" status "$key" > "$work/status.out" 2>&1
  grep -qi "park" "$work/status.out" || { cp "$work/status.out" "$work/last.out"; fail "status does not show the park"; }
}
stage() {
  swamp behavior run "$WI" status "$key" > "$work/last.out" 2>&1
  grep -q "at stage '$1' cycle" "$work/last.out" || fail "not at stage $1"
}
# record KIND NAME JSON: record an artifact or evidence from a file, as a
# driver records a subagent's result.
record() {
  printf '%s\n' "$3" > "$work/payload.json"
  w "record_$1" "name=$2" "payload=@$work/payload.json"
}
# packet: the JSON packet the last dispatch printed.
packet() {
  sed -n '/^packet: {$/,/^}$/p' "$work/last.out" | sed '1s/^packet: //'
}
# walk FROM TO: replay saved scenario two-review-rounds' steps FROM to TO.
walk() {
  jq -c --argjson a "$1" --argjson b "$2" \
    '.globalArguments.scenarios[] | select(.scenario == "two-review-rounds") | .steps[$a - 1:$b][]' \
    "$work/scenarios.json" | while read -r s; do
    t=$(echo "$s" | jq -r '.expect.refused // empty')
    case $(echo "$s" | jq -r '[keys_unsorted[] | select(. != "payload" and . != "manual" and . != "note")][0]') in
      record) set -- "$(echo "$s" | jq -r '.record | keys[0]')" "$(echo "$s" | jq -r '.record[]')" "$(echo "$s" | jq -c .payload)"
        if [ -n "$t" ]; then printf '%s\n' "$3" > "$work/payload.json"; refused "$t" "record_$1" "name=$2" "payload=@$work/payload.json"; else record "$@"; fi ;;
      move) set -- advance "transition=$(echo "$s" | jq -r .move)"
        [ "$(echo "$s" | jq -r '.manual // false')" = true ] && set -- "$@" confirm=true
        if [ -n "$t" ]; then refused "$t" "$@"; else w "$@" || fail "$*"; fi ;;
      override) w grant_override kind=cycle "stage=$(echo "$s" | jq -r .override.stage)" \
        "note=$(echo "$s" | jq -r .override.note)" || fail override ;;
      expect) stage "$(echo "$s" | jq -r .expect.stage)" ;;
      *) fail "walk can't replay $s" ;;
    esac
  done
}

echo "==> a swamp repo with the Factory and the definition"
mkdir "$work/swamp" && cd "$work/swamp"
git init -q && swamp repo init --json > /dev/null
swamp extension source add "$factory" --json > /dev/null
swamp extension trust add puddleworks --json > /dev/null
swamp behavior create @puddleworks/puddleworks-factory/draft puddleworks-factory --json > /dev/null
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
swamp behavior get fb --json > "$work/scenarios.json"
: > "$work/expect"
w start factory=fb || fail start

echo "==> intake, with a gate no one approved and an approval for another gate"
record artifact spec "{\"name\":\"obsidian-puddle-scanner\",\"source\":\"$spec\",\"digest\":\"$digest\"}" || fail spec
record artifact assessment '{"verdict":"build-functionality","reason":"nothing fits","chosen":null}' || fail assessment
refused "awaiting approval 'spec-approval'" advance transition=build
refused "publish-approval" approve gateId=publish-approval
w approve gateId=spec-approval || fail approve
w advance transition=build || fail build
app="$work/app"
mkdir "$app" && git -C "$app" init -q -b main && git -C "$app" remote add origin "$repo.git"
(cd "$app" && swamp repo init --json > /dev/null)
record evidence target "{\"repository\":\"$repo\",\"checkout\":\"$app\",\"branch\":\"$branch\",\"route\":\"build\",\"exists\":true}" || fail target
w advance transition=existing || fail existing

echo "==> generate: the packet's inputs reach render, which refuses the wrong branch"
w dispatch || fail dispatch
packet > "$work/p1.json"
d=$(jq .dispatchId "$work/p1.json")
jq -e --arg b "$branch" --arg d "$app" --arg g "$digest" \
  '.inputs.branch == $b and .inputs.targetDir == $d and .inputs.specDigest == $g' "$work/p1.json" > /dev/null ||
  fail "generate's packet does not pass branch, targetDir and specDigest: $(jq -c .inputs "$work/p1.json")"
render() {
  jq -r '.inputs | to_entries[] | "--input\n\(.key)=\(.value)"' "$work/p1.json" > "$work/args"
  # shellcheck disable=SC2046
  (IFS='
' && swamp behavior run puddleworks-factory render $(cat "$work/args") --json) > "$work/render.out" 2>&1
}
files() { (cd "$app" && find . -path ./.git -prune -o -path ./.swamp -prune -o -type f -print | sort | xargs sha256sum); }
was=$(files)
if render; then fail "render wrote into a checkout on main"; fi
grep -q "checked out, not $branch" "$work/render.out" || { cat "$work/render.out" >&2; fail "render's refusal"; }
[ "$(files)" = "$was" ] || fail "a refused render wrote files"
w record_outcome "dispatchId=$d" outcome=failed "reason=render refused the branch" || fail outcome
record evidence draft '{"status":"failed","runId":"render-1"}' || fail draft
refused "succeeded" advance transition=generated

echo "==> generate again on the draft branch, past the dispatch cap"
git -C "$app" switch -q -c "$branch"
w dispatch || fail dispatch
d=$(packet | jq .dispatchId)
render || { cat "$work/render.out" >&2; fail "render on $branch"; }
w record_outcome "dispatchId=$d" outcome=succeeded || fail outcome
parks "runaway loop suspected" dispatch
w grant_override kind=dispatch "note=check the cap opens" || fail override
w dispatch || fail "dispatch after a dispatch override"
w record_outcome "dispatchId=$(packet | jq .dispatchId)" outcome=succeeded || fail outcome
record evidence draft '{"status":"succeeded","runId":"render-2"}' || fail draft
w advance transition=generated || fail generated
stage plan

echo "==> a rejected payload is kept as feedback, then cleared"
printf '%s\n' '{"summary":"no steps"}' > "$work/payload.json"
# Kept on the work item, so unlike other refusals this one writes.
if w record_artifact name=plan "payload=@$work/payload.json"; then fail "a plan with no steps was recorded"; fi
grep -q "rejected and kept as retry feedback" "$work/last.out" || fail "the plan's refusal"
swamp behavior run "$WI" status "$key" > "$work/last.out" 2>&1
grep -q "plan" "$work/last.out" && grep -qi "reject" "$work/last.out" || fail "status does not show the rejected plan"
record artifact plan '{"summary":"Scan","steps":[{"description":"Scan the vault","files":["extensions/models/obsidian_puddle_scanner.ts"]}],"testingStrategy":"One test per criterion","versionBump":{"needed":false,"reason":"First version"}}' || fail plan
swamp behavior run "$WI" status "$key" > "$work/last.out" 2>&1
grep -qi "reject" "$work/last.out" && fail "the rejection was not cleared"
w advance transition=submit || fail submit
record artifact plan-review '{"findings":[]}' || fail plan-review
w approve gateId=plan-approval || fail approve
w advance transition=approve || fail approve
stage implement

echo "==> a manual exit without confirm, a stale view, and two submits at once"
refused "manual" advance transition=recheck
walk 14 14
cp "$work/expect" "$work/expect.implement"
for n in 1 2; do
  (swamp behavior run "$WI" advance "$key" --input transition=submit \
    $(sed 's/[^ ]*/--input &/g' "$work/expect") > "$work/submit$n.out" 2>&1 && echo ok > "$work/submit$n") &
done
wait
[ "$(cat "$work"/submit? 2>/dev/null | wc -l)" = 1 ] || fail "two submits at once: $(cat "$work"/submit? 2>/dev/null | wc -l) went through"
stage check
sed -n 's/^  expect: //p' "$work/last.out" | sed 's/--input //g' > "$work/expect"
cp "$work/expect" "$work/expect.check"
cp "$work/expect.implement" "$work/expect"
printf '%s\n' '{"commit":"1111111111111111111111111111111111111111","status":"passed","results":[{"name":"test","status":"passed"}]}' > "$work/payload.json"
refused "stale" record_evidence name=checks "payload=@$work/payload.json"
cp "$work/expect.check" "$work/expect"

echo "==> interrupted dispatches resume from a checkpoint, then park"
# Dispatch ids count up over the whole work item, so read each from its packet.
w dispatch || fail dispatch
d=$(packet | jq .dispatchId)
w record_checkpoint "dispatchId=$d" 'payload={"ran":"make test"}' || fail checkpoint
w dispatch "supersedes=$d" || fail supersedes
packet | jq -e --argjson d "$d" '.resume.fromDispatch == $d' > /dev/null ||
  fail "the next dispatch does not resume from the interrupted one's checkpoint"
for i in 1 2; do
  w dispatch "supersedes=$(packet | jq .dispatchId)" || fail supersedes
done
parks "restart loop suspected" dispatch "supersedes=$(packet | jq .dispatchId)"
w grant_override kind=dispatch "note=the restarts are fixed" || fail override
w dispatch || fail "dispatch after a dispatch override"

echo "==> round 1 reviews the whole repo"
walk 16 24
w dispatch || fail dispatch
grep -q "This is review round 1 of 2" "$work/last.out" && grep -q "Review the whole repo." "$work/last.out" ||
  fail "round 1's prompt"

echo "==> round 2 reviews only the diff"
walk 25 37
w dispatch || fail dispatch
grep -q "This is review round 2 of 2" "$work/last.out" &&
  grep -q "Review only what changed since round 1: git -C $app diff 1111111111111111111111111111111111111111" "$work/last.out" ||
  fail "round 2's prompt"

echo "==> a third review needs Factory's grant and a cycle override"
walk 38 54

test "$(git -C "$factory" status --porcelain)" = "$before" ||
  { echo "the Factory checkout changed" >&2; exit 1; }
echo "stagecraft drive: ok"
