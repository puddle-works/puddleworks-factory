---
name: factory-build
description: >
  Take an agreed outcome spec (puddleworks.dev/outcome-spec/v1) or a
  puddleworks.dev/app-spec/v1 spec (a file path, an https URL or inline JSON)
  to a published swamp extension in one run: for an outcome spec, prefill an
  app spec and agree the builder's decisions with the user; generate the
  skeleton in the app's own repo (made from puddle-works/puddle-template, with
  both specs kept beside it); build the behaviour test-first; get it through
  the publish checks; recommend public or private and ask; write the review
  report; publish once the user confirms, and record the result. Triggers on:
  "factory build", "build from spec", "build this puddle", "publish this
  puddle", "/factory-build <spec>".
---

# Factory Build

Take an app spec to a published extension, aiming for about an hour. Quality
comes from checks that must pass, not from extra steps:

1. **Generate**: the `@puddleworks/puddleworks-factory-build` workflow checks
   the spec against the contract and writes a skeleton that compiles and passes
   its own tests, on `draft/NAME` in the app's own repo. Everything starts
   private.
2. **Build**: you fill in the behaviour test-first, within the spec.
3. **Get it ready**: format, tests, contracts, guardrails and quality must all
   pass, then a PR to the app repo.
4. **Decide visibility**: the `@puddleworks/puddleworks-factory-visibility`
   workflow recommends public or private; the user decides.
5. **Publish**: the review report, a clean dry run, then the push once the user
   confirms. The build result records what was published.

Creating a repo, making it public and pushing to the registry are outward
steps: ask before each one. Never merge the PR; the user does.

Factory reads only the spec. Whoever wrote the spec (a person, another tool)
has already agreed it; Factory does not check approvals.

## Input

The spec: a file path, an `https://` URL, or the JSON itself. Ask for it if the
user did not give one.

The app repo: each app gets its own repo, `puddle-works/NAME`, made from the
template `puddle-works/puddle-template` (ADR-004). `APP` is the absolute path of
its checkout. Step 2 creates the repo and the checkout if they do not exist
yet. If the user names an existing checkout, use that.

Check which kind of spec it is:

```bash
jq -r '.format // .apiVersion' SPEC_FILE   # or: curl -fsSL SPEC_URL | jq -r '.format // .apiVersion'
```

- `puddleworks.dev/outcome-spec/v1`: an agreed request
  (`docs/contracts/outcome-spec.md`). It says what success looks like, not how
  to build it. Do step 1, then **step 1a** to turn it into an app spec.
- `puddleworks.dev/app-spec/v1`: already an app spec
  (`docs/contracts/app-spec.md`). Its `name` is the app name. Skip step 1a.

Below, `NAME` is the app name, `SPEC` is the app spec to build from, `REPO` is
the app repo's https URL (`https://github.com/puddle-works/NAME`), `W` is
`APP-draft-NAME`, a worktree beside `APP`, and `SP` is the scratchpad directory.
The contracts are in `docs/contracts/` in the puddleworks-factory repo.

## Step 1: Make sure the factory model exists

Run swamp from the swamp repo where `@puddleworks/puddleworks-factory` is installed.
Check for the model instance:

```bash
swamp model get puddleworks-factory --json 2>&1 | jq -r '.type // .error'
```

`@puddleworks/puddleworks-factory/draft` means it exists.
`Model not found: puddleworks-factory` means create it once:

```bash
swamp model create @puddleworks/puddleworks-factory/draft puddleworks-factory --json | jq -r .type
```

## Step 1a: Prefill an app spec from an outcome spec

Skip this for an app spec. Let `OUTCOME` be the absolute path of the outcome spec file. If the user gave a URL or pasted
JSON, save it first (`curl -fsSL URL -o SP/outcome-spec.json`, or write the
JSON there) and use that path. Prefill a starter app spec:

```bash
swamp workflow run @puddleworks/puddleworks-factory-prefill --input outcomeSpec=OUTCOME --input out=SP/app-spec.json --json \
  | jq -r '.status + " " + ([.jobs[].steps[] | select(.status=="failed") | .error] | join(" | "))'
```

`succeeded` means `SP/app-spec.json` holds a starter: title, purpose, out of
scope, who agreed it and when, and a `source` linking back to the request,
version and hash. It is **not** buildable yet. `Refusing to replace` means a
starter from an earlier run is there: show it to the user and add
`--input overwrite=true` only if they want to start again.
`is not a valid puddleworks.dev/outcome-spec/v1 spec` lists what is wrong with
the export; fix it where it was written and export again.

Read what is left to decide and anything to sort out first:

```bash
swamp data query "behavior(\"puddleworks-factory\") && name == \"prefill-$(jq -r .name SP/app-spec.json)\"" \
  --select content --json | jq '.results[0] | {toDecide, warnings}'
```

If `warnings` lists open questions, show them and ask whether to go on; they are
better answered by whoever agreed the spec first. Then read the whole outcome
spec (problem, desired outcome, scope, constraints, assumptions, acceptance
criteria) and **propose** a value for each `toDecide` field, in one message:

- `name`: short, lowercase, hyphens. The suggestion is the title as a slug and
  is often too long.
- `specification.purpose`: one bounded sentence.
- `specification.inputs`: what the person enters each run, each with `name`
  (camelCase), `type` (`string`, `number`, `integer` or `boolean`),
  `description`, and `required: true`, or `required: false` with a `default`.
- `specification.output`: what one run produces.
- `specification.settings`: what the builder sets once (paths, tokens), each
  with `name` (camelCase), `description` and `sensitive` (true for secrets,
  which are then read with `vault.get()`). Empty is fine.
- `delivery.method`: usually `workflow_form`; `scheduled_workflow` if it runs
  on a timer; `external_app` or `manual_process` mean there is nothing to draft.

Use `AskUserQuestion` for choices with real alternatives, and wait for the user
to confirm or change every field. Do not build on your own guesses. Write the
agreed values into `SP/app-spec.json` (keep `source` as it is), then check it:

```bash
jq -e '.name and .specification.output != "" and .delivery.method != ""' SP/app-spec.json
```

`NAME` is now the agreed `name`. After step 2, both specs are kept beside the
skeleton, so the build can always be traced back to what was agreed:

```bash
mkdir -p W/spec
cp OUTCOME W/spec/outcome-spec.v$(jq -r .specification.version OUTCOME).json
cp SP/app-spec.json W/spec/app-spec.json
```

In step 3, `SPEC` is `W/spec/app-spec.json`.
The build checks it fully: a field left blank fails there with
`is not a valid puddleworks.dev/app-spec/v1 spec`.

## Step 2: Make the app repo and a branch in it

Check whether the repo exists:

```bash
gh repo view puddle-works/NAME --json visibility -q .visibility
```

`PRIVATE` or `PUBLIC` means it exists: use the user's checkout as `APP`, or
clone it (`gh repo clone puddle-works/NAME APP`). `Could not resolve to a
Repository` means it does not exist yet. Creating a repo is outward-facing, so
**ask first**, naming the repo and where the checkout goes (suggest
`$HOME/dev/NAME`). On yes:

```bash
gh repo create puddle-works/NAME --template puddle-works/puddle-template --private --clone=false
gh repo clone puddle-works/NAME APP
ID=$(gh api repos/puddle-works/NAME -q .id)
for S in SWAMP_API_KEY SWAMP_SIGNIN_TOKEN; do gh api -X PUT orgs/puddle-works/actions/secrets/$S/repositories/$ID; done
```

The last two lines give the repo the org secrets its CI publish dry run needs
(they are shared with selected repos only). They need a token with `admin:org`;
if `gh api` answers `403`, tell the user to add the repo under **Repository
access** at `https://github.com/organizations/puddle-works/settings/secrets/actions`
for both secrets.

Every app starts private. Whether it goes public is decided at the end, once the
extension is built and checked. A clone straight after `gh repo create` can
come back empty while GitHub copies the template: if `git -C APP log` says
`does not have any commits yet`, wait a few seconds, delete `APP` and clone
again.

Make the branch:

```bash
git -C APP fetch origin --quiet
git -C APP worktree add W -b draft/NAME origin/main
```

Expect `HEAD is now at …`. If the branch already exists, this is a re-draft:
reuse the existing worktree, skip the clean-up below, and pass `overwrite=true`
in step 3 only if the user agrees to replace the files. This is a plain git
worktree: do not link it to any other worktree.

On a new branch, remove the template's placeholders so the draft replaces them,
and give the repo its own swamp `repoId`:

```bash
git -C W rm -q --ignore-unmatch manifest.yaml README.md extensions/models/example.ts \
  extensions/models/example_test.ts workflows/example.yaml 'swamp-extension-review/_puddleworks_puddle-template-*.json'
{ head -1 W/contracts.ts; printf '\n// Maps each model instance a workflow reads with data.latest(...) to its type and the data names it writes.\nexport const CONTRACTS: Contracts = {};\n'; } > SP/contracts.ts
mv SP/contracts.ts W/contracts.ts
(cd W && swamp repo init --force --tool claude >/dev/null)
git -C W add -A
git -C W commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "Remove the template placeholders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`contracts.ts` keeps the template's `Contracts` import (and so its
puddle-tooling version) and loses the example entry. `swamp repo init --force`
only rewrites its own managed section of `CLAUDE.md`; the template's "Puddle
repo" section stays.

## Step 3: Generate the skeleton

```bash
swamp workflow run @puddleworks/puddleworks-factory-build --input spec=SPEC --input targetDir=W --input repository=REPO --json \
  | jq -r '.status + " " + ([.jobs[].steps[] | select(.status=="failed") | .error] | join(" | "))'
```

For inline JSON, quote it: `--input "spec=$(cat spec.json)"`. The draft is
private under `@puddleworks/NAME` by default; going public is the last step,
after the build. The skeleton goes in the root of `W`: the extension, its test
and the workflow under `extensions/models/` and `workflows/`, plus
`manifest.yaml`, `README.md`, `LICENSE` (the template's is kept) and a marked
app section in `CLAUDE.md` (added, or replaced on a re-draft).

`succeeded` means the files are written. On `failed`, tell the user what the
message says in plain words and stop:

| Message contains                                        | Meaning                                        | What unblocks it                                        |
| ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `is not a valid puddleworks.dev/app-spec/v1 spec`       | The spec breaks the contract; each rule listed | Fix the spec where it was written                       |
| `is not JSON or YAML`                                   | The spec text does not parse                   | Fix the file, or quote the inline JSON                  |
| `Could not read` / `returned 404` / `only fetched over` | The spec could not be read                     | Check the path or URL; URLs must be `https://`          |
| `has no swamp workflow to draft`                        | Delivery is `external_app` or `manual_process` | Nothing to draft; this skill does not apply             |
| `Refusing to overwrite files that already exist`        | A draft is already on this branch              | Re-run with `--input overwrite=true` if the user agrees |
| `does not look like an app repo checkout`               | `targetDir` has no `.swamp.yaml`               | Point it at the app repo worktree from step 2           |
| `must be the https URL of the app's repo`               | `repository` is not an `https://` URL          | Pass `REPO`, e.g. `https://github.com/puddle-works/NAME` |

Then commit the skeleton untouched (with `spec/` when it came from an outcome
spec), so review can tell generated code from written code:

```bash
git -C W add -A
git -C W commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "draft: generated skeleton for NAME" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C W push -u origin draft/NAME
```

Then write the build result (`puddleworks.dev/build-result/v1`, see
`docs/contracts/build-result.md` in the puddleworks-factory repo), so whoever
handed over the spec can see where the build went. The repository is the one
the draft was built with:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=draft/NAME --input out=SP/NAME.build-result.json --json | jq -r .status
```

Expect `succeeded`. `No draft of "NAME" has been rendered` means the generate
step above did not run on this swamp repo's `puddleworks-factory` model.


## Step 4: Plan the build

Read the app section of `W/CLAUDE.md` (purpose, inputs, settings, output, out
of scope), the spec, the skeleton under `W/extensions/models/` and
`W/workflows/`, and `W/manifest.yaml`. If it came from an outcome spec, also
read `W/spec/outcome-spec.v*.json`: its acceptance criteria are what "done"
means, so each one becomes a test or a verification step, and its constraints
and assumptions are scope lines. Write a short plan to `SP/plan.md`:

- **What to build**, within the spec: the behaviour that replaces the `run`
  stub, and the shape of `ResultSchema.items`.
- **Tests to write first**, one or more per acceptance criterion. They call
  `run` directly with working settings (a temp directory, a fake server). The
  generated tests and their `SETTINGS` placeholders stay as they are.
- **Scope lines**: do not rename, add or remove inputs or settings; do not add
  anything on the out-of-scope list, new permissions, or secrets the settings
  do not name. Search before building (`swamp extension search`).

If the behaviour cannot be built within these limits, or the spec leaves a
choice open that changes what the user gets, stop and ask; do not build on a
guess. Otherwise carry straight on.

## Step 5: Build it test-first

Work in `W`. For each test in the plan: write it, run `make test` and see it
fail for the right reason, then write the code that makes it pass. If the tests
need Deno permissions (`--allow-read` and so on), add the same flags to the
"Test it" command in `W/README.md`, the `test` target of `W/Makefile` and the
`deno test` lines of `W/.github/workflows/ci.yml`, so all three run the same
tests.

Then run the workflow once for real, as `W/README.md` says (create the model
instance, then `swamp workflow run <entryPointRef>`), with settings that work
on this machine. If a setting needs a credential the user has not given, ask
for it or skip the run, and say which in the report.

```bash
git -C W add -A
git -C W commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "Build the NAME behaviour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Step 6: Get it through the checks

```bash
cd W
swamp extension fmt manifest.yaml
make test
make contracts-check
make guardrails-check
swamp workflow validate ENTRY_POINT_REF
swamp extension quality manifest.yaml --json | jq '{percentage, gateFailures}'
```

`ENTRY_POINT_REF` is the full `@<collective>/<slug>` name from `W/README.md`;
the `model not found` warning from `validate` is expected in a fresh worktree.
Each must pass, and quality must be `100` with no `gateFailures`: fix the code
(JSDoc on exports, a README, the licence) until it is. The draft is not
formatted as generated, so `fmt` changes files the first time. Commit what
changed, as in step 5, with the message `Get NAME ready to publish`.

## Step 7: Recommend public or private, and ask

```bash
Q=$(cd W && swamp extension quality manifest.yaml --json | jq .percentage)
RV=$(gh repo view puddle-works/NAME --json visibility -q .visibility | tr A-Z a-z)
swamp workflow run @puddleworks/puddleworks-factory-visibility --input name=NAME \
  --input quality=$Q --input repoVisibility=$RV --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "visibility-NAME"' \
  --select content --json | jq '.results[0] | {recommendation, canBePublic, checks, findings}'
```

Run this from the swamp repo from step 1, like the other Factory
workflows. The method reads every text file in `W` (not `.git`, `.swamp`,
`.claude/skills`, `node_modules`) and gives the same answer for the same files:

| Check              | Role     | Fails when                                                                   |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `licence`          | required | No `license:` in the manifest, or no `LICENSE` file                          |
| `repository`       | required | No `https://` `repository:` in the manifest                                  |
| `quality`          | required | Quality below 100%                                                           |
| `secrets`          | required | A key or token is in the files (its text is never shown)                     |
| `internal-details` | signal   | Home paths, internal hosts, private IPs or real email addresses              |
| `audience`         | signal   | The spec's `specification` says it is internal, confidential, for "our team" |
| `repo-visibility`  | info     | The GitHub repo and the manifest disagree; decides nothing                   |

A failed `secrets` check means the secret is in git history: tell the user to
rotate it, and remove it before anything else. Show the recommendation, every
check that failed, and each finding (`file:line` and the line), then ask with
`AskUserQuestion`, the recommendation first. Offer **Public** only when
`canBePublic` is true; otherwise say which required checks block it.

Set the visibility **now**, before the review report: the report is bound to
the content hash, and the manifest is part of it. Never pass `--visibility` to
`swamp extension push`; it changes the hash too. For **private**, the manifest
and `ci.yml` already say `private`. For **public**, after the user's answer:

```bash
sed -i '' 's/^visibility: private$/visibility: public/' W/manifest.yaml
sed -i '' 's/visibility: private # must equal/visibility: public # must equal/' W/.github/workflows/ci.yml
grep -n '^visibility:' W/manifest.yaml; grep -n 'visibility:' W/.github/workflows/ci.yml
git -C W commit -q -am "Publish NAME publicly" --author="Claude Code <claude-code@anthropic.com>" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expect `visibility: public` from both greps. The GitHub repo itself is made
public in step 9, with the push. `V` below is the chosen visibility.

## Step 8: Write the review report and open the PR

Review the code first, following the swamp skill's
`references/extension/references/adversarial-review.md`: its mechanical checks,
then each dimension. Fix anything it finds before writing the report: any code
change moves the content hash, and so the report path. Then get the skeleton
and its path from a dry run:

```bash
cd W
SWAMP_EXTENSION_REVIEW_DIR=$(pwd) swamp extension push manifest.yaml --dry-run --json \
  | jq '.warnings.review[] | select(.ruleId == "adversarial-review-report") | {file, skeleton}' > SP/review.json
jq -r .file SP/review.json
```

Write `.skeleton` to `.file`, with `reviewedAt` set to now and every
dimension's `verdict` set to `pass`, `na` (the dimension does not apply), or
`issue` with a `note`. Leave none `pending`. An `issue` is reported by the dry
run as a warning, and `make publish` stops on every warning except version
drift: fix the problem and review again rather than publish with one. Then:

```bash
make publish VISIBILITY=V DRY_RUN=1
```

Expect `dry run only; nothing was pushed`, after the tests, `deno check`,
`fmt --check`, the quality gate and a dry run with no warnings. A
`declares visibility` error means step 7's change was not committed. Commit the
report, push, and open the PR to the app repo:

```bash
git -C W add swamp-extension-review/
git -C W commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "Review NAME for publishing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C W push -u origin draft/NAME
gh pr create --repo puddle-works/NAME --head draft/NAME --base main \
  --title "Build NAME" --body-file SP/pr.md
```

`SP/pr.md` says what was built, how it was tested (and whether the real run in
step 5 happened), the visibility and why, the review's verdicts, and ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The PR's CI
runs the same publish dry run, so it is green only with the report committed.

## Step 9: Publish, once the user confirms

Publishing is outward-facing, and a public package or repo may be cached even
if it is changed back later. Show the package (`@puddleworks/NAME`), the
version from `W/manifest.yaml`, `V`, the PR, and that it is published from the
reviewed commit on `draft/NAME`. Ask; on yes:

```bash
gh repo edit puddle-works/NAME --visibility public --accept-visibility-change-consequences   # public only
cd W && make publish VISIBILITY=V
```

Expect `published @puddleworks/NAME@VERSION (HASH)`. `make publish` never
passes `--yes`; the clean dry run is its gate. If it stops, read what it lists,
fix it, and repeat from step 8 (the report must match the new hash). A version
that is already published needs a new `version:` in the manifest, which also
means a new review.

## Step 10: Record it and report

Write the build result again, now with the PR and what was published:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=draft/NAME --input pullRequest=PR_URL \
  --input publishedVersion=VERSION --input publishedVisibility=V \
  --input out=SP/NAME.build-result.json --json | jq -r .status
```

Expect `succeeded`; `Pass publishedVersion and publishedVisibility together`
means one was left out. If the user stopped before publishing, leave both out.

Tell the user: the package and version, its visibility and why, the PR (which
they merge), the build result file, how long the run took, and anything
skipped (the real run, a check). If the spec had a `source`, the build result
names the request, version and hash, so it can be matched to the request later.
