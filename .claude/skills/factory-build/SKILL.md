---
name: factory-build
description: >
  Take an agreed outcome spec (puddleworks.dev/outcome-spec/v1) or a
  puddleworks.dev/app-spec/v1 spec (a file path, an https URL or inline JSON)
  to a published swamp extension in one run: for an outcome spec, prefill an
  app spec and agree the builder's decisions with the user; generate the
  skeleton in the app's own repo (made from the template repo, with
  both specs kept beside it); build the behaviour test-first; get it through
  the publish checks; recommend public or private and ask; have a fresh agent
  review it against the spec; publish once the user confirms a one-screen
  summary, and record the result. Triggers on:
  "factory build", "build from spec", "build this extension", "publish this
  extension", "/factory-build <spec>".
---

# Factory Build

It makes each app's repo in a GitHub organisation from a template repo, can
grant the new repo some of that organisation's Actions secrets, and builds in an
Orca worktree, or a plain `git worktree` when Orca is not installed. The
organisation, template, secrets, collective and worktree tool are settings; the
defaults are the
ones Puddleworks uses (see Settings, and the package README).

Take an app spec to a published extension, aiming for about an hour. Quality
comes from checks that must pass, not from extra steps:

1. **Intake and reuse** (Input, step 1): read the spec and check it against
   its contract. There is no check for an existing extension to reuse yet.
2. **Agree and select target** (steps 1a, 2): for an outcome spec, prefill an
   app spec and agree the builder's decisions with the user; make the app's
   own repo from the template and the `draft/NAME` branch. Everything starts
   private.
3. **Generate and implement** (steps 3 to 5): the
   `@puddleworks/puddleworks-factory-build` workflow checks the spec against
   the contract and writes a skeleton that compiles and passes its own tests;
   you plan the build and fill in the behaviour test-first, within the spec.
4. **Validate** (step 6): format, tests, contracts, guardrails and quality must
   all pass.
5. **Decide visibility** (step 7): the
   `@puddleworks/puddleworks-factory-visibility` workflow recommends public or
   private; the user decides.
6. **Independent review** (step 8): a fresh agent that has not seen the build
   reviews the repo against the spec, writes the review report and maps each
   acceptance criterion to its tests. The
   `@puddleworks/puddleworks-factory-readiness` workflow checks nothing is
   left.
7. **PR and publication** (steps 9, 10): a PR to the app repo, then a clean dry
   run and the push once the user confirms the readiness summary.
8. **Record** (step 3, and again with the publish): the build result records where the build went
   and what was published.

These are the stages of `docs/factory-quality-and-gates-plan.md` in the
puddleworks-factory repo. The steps below keep their numbers, and refer to each
other by them.

Creating a repo, making it public and pushing to the registry are outward
steps: ask before each one. Never merge the PR; the user does.

Factory reads only the spec. Whoever wrote the spec (a person, another tool)
has already agreed it; Factory does not check approvals.

## Settings

Read these before step 1, from `factory-build.json` at the root of the swamp
repo you run from (a key it leaves out keeps its default). An argument to
`/factory-build` (`org=acme`) overrides both for that run.

| Key          | Default                         | What it sets                                                  |
| ------------ | ------------------------------- | ------------------------------------------------------------- |
| `org`        | `puddle-works`                  | GitHub organisation or user that owns each app repo           |
| `template`   | `puddle-works/puddle-template`  | Template repo each app repo is made from                      |
| `secrets`    | `SWAMP_API_KEY`, `SWAMP_SIGNIN_TOKEN` | Org Actions secrets granted to a new repo; `[]` grants none |
| `collective` | `@puddleworks`                  | Collective the apps are published under (`typeScope`)         |
| `worktrees`  | `orca`                          | `orca` or `git`; `git` is used anyway when `orca` is not installed |

```bash
O='{}'   # the arguments given to /factory-build, e.g. O='{"org":"acme"}'
D='{"org":"puddle-works","template":"puddle-works/puddle-template",
    "secrets":["SWAMP_API_KEY","SWAMP_SIGNIN_TOKEN"],"collective":"@puddleworks",
    "worktrees":"orca"}'
F='{}'; if [ -f factory-build.json ]; then F=$(cat factory-build.json); fi
S=$(jq -es --argjson a "$O" 'select(length == 2) |
    (.[1] | objects) as $o | .[0] * $o * $a |
    def ok($re): type == "string" and test($re);
    select((.org | ok("^[A-Za-z0-9][A-Za-z0-9-]*$")) and
      (.template | ok("^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$")) and
      (.collective | ok("^@[a-z0-9-]+$")) and (.worktrees | IN("orca", "git")) and
      (.secrets | type == "array" and all(ok("^[A-Za-z_][A-Za-z0-9_]*$"))))' \
  <(echo "$D") <(printf %s "$F")) || {
  W="the arguments (O=)"; [ -f factory-build.json ] && W="factory-build.json or the arguments (O=)"
  echo "$W must be one JSON object, with org a GitHub owner, template owner/repo, collective @name, worktrees orca or git, and secrets a list of secret names: fix whichever is wrong" >&2; exit 1; }
[ -f factory-build.json ] || echo "no factory-build.json here: using the defaults" >&2
ORG=$(jq -r .org <<<"$S"); TEMPLATE=$(jq -r .template <<<"$S")
SECRETS=$(jq -r '.secrets | join(" ")' <<<"$S"); COLLECTIVE=$(jq -r .collective <<<"$S")
WT=$(jq -r .worktrees <<<"$S"); command -v orca >/dev/null || WT=git
```

Shell variables don't last from one Bash call to the next, so run this block
again, from that repo root, at the start of every Bash call that uses `$ORG`,
`$TEMPLATE`, `$SECRETS`, `$COLLECTIVE` or `$WT`. Run it from the swamp repo
root, not from an app worktree: elsewhere it says "no factory-build.json here"
and uses the defaults. If the user gave arguments to `/factory-build`, put them
in the first line (`O='{"org":"acme"}'`) every time, or the file's values come
back. If it stops, show the user its message and wait for the file or the
arguments to be fixed. Don't carry on with the defaults.

The template must give each app a `Makefile` with `test`, `contracts-check`,
`guardrails-check` and `publish` targets, and a `contracts.ts`.

Commits use the git config of the machine, and end with whatever attribution the
user's instructions ask for.

## Input

The spec: a file path, an `https://` URL, or the JSON itself. Ask for it if the
user did not give one.

The app repo: each app gets its own repo, `ORG/NAME`, made from the
template `$TEMPLATE`. `APP` is the absolute path of
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

An outcome spec at version 2 or more may be for a request that already has an
app: its Capture page lists a build result with the repo. Check with
`jq -r .request.id APP/spec/outcome-spec.v1.json`, which must equal the
export's `request.id` (the `request.url` may differ). If it does, follow
**Revising an app that is already built** below instead of steps 1a to 3.

Below, `NAME` is the app name, `SPEC` is the app spec to build from, `REPO` is
the app repo's https URL (`https://github.com/ORG/NAME`), `W` is the
worktree step 2 makes for the build (with Orca, `~/orca/workspaces/NAME/draft-NAME`; with git, `NAME-draft` beside `APP`),
and `SP` is the scratchpad directory.
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
swamp model create @puddleworks/puddleworks-factory/draft puddleworks-factory --global-arg "typeScope=\\$COLLECTIVE" --json | jq -r .type
```

Every Factory workflow below is run with `--json` and piped through `jq`, so a
run that prints nothing at all looks like one that did nothing wrong. It is
not: no status means the run didn't happen. Check with
`swamp workflow history get WORKFLOW --json | jq -r '[.id, .status, .startedAt // ""] | join(" ")'`
(`WORKFLOW` is the `@puddleworks/...` name in the command): a run that started
before this one, or none, confirms it. Then run the same command once more. If it
prints nothing again, stop and tell the user, with `swamp --version`. This has
happened once, straight after swamp updated itself and ran `swamp repo upgrade`.

## Step 1b: Check whether an existing extension already does it

Do this for an outcome spec, before step 1a and before any repo is made. An app
spec has already been through it; skip to step 2.

Read the outcome spec's desired outcome, scope, inputs it implies and recipe
examples. Decide `DELIVERY`: `packaged_script` if someone asks for it with a
phrase, `scheduled_workflow` if it runs on a timer. Then search, `@swamp/*`
first: `swamp extension search QUERY --json` for the registry,
`swamp behavior type search QUERY --json` for what is installed, and
`swamp behavior type describe TYPE --json` for each likely type's methods. For
each method that might do the job, judge five fit checks, true or false:

- `wholeJob`: it produces the spec's outcome from its inputs. Nothing on the
  spec's out-of-scope list may be added to make it fit.
- `readOnly`: it changes nothing (a recipe runs nothing else).
- `inputs`: each input maps to a method argument as `int`, `repo` or `word`, or
  is fixed in the step.
- `settings`: each setting maps to the extension's model definition, a
  sensitive one by `vault.get(...)`.
- `output`: it can be shown as text with `each`, `template` and `empty`; for a
  schedule, it is the outcome asked for, with nothing added.

Write them to `SP/candidates.json` (`[]` if the search found nothing):

```json
[{"extension": "@webframp/github", "type": "@webframp/github", "method": "get_repo_info",
  "checks": {"wholeJob": false, "readOnly": true, "inputs": true, "settings": true, "output": false},
  "note": "covers only a named GitHub repo; no file path"}]
```

Then record the verdict, with `A` a short lowercase name for the request (the
app name you would suggest in step 1a):

```bash
swamp workflow run @puddleworks/puddleworks-factory-assess --input outcomeSpec=OUTCOME \
  --input candidates=SP/candidates.json --input delivery=DELIVERY --input name=A --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "assessment-A"' \
  --select content --json | jq '.results[0] | {verdict, reason, chosen, candidates: [.candidates[] | {extension, method, owner, failed}]}'
```

Show the user the verdict, its reason and each candidate with the checks it
failed, and ask with `AskUserQuestion` whether to act on it; choosing someone
else's extension over a new build is their call. `build-functionality`, or a
no, carries on to step 1a. Otherwise write one workflow and no model code:

| Verdict                     | Write                                   | Where                                       |
| --------------------------- | --------------------------------------- | ------------------------------------------- |
| `recipe-in-our-extension`   | a recipe for `chosen.method`            | `chosen.extension`'s own repo               |
| `recipe-in-pack`            | a recipe for `chosen.method`            | `ORG/recipes-external`                      |
| `workflow-in-our-extension` | a scheduled workflow for `chosen.method` | `chosen.extension`'s own repo               |
| `workflow-app`              | a scheduled workflow for `chosen.method` | a new `ORG/NAME` that holds only it         |

For `recipe-in-pack`, check the pack exists with
`gh repo view ORG/recipes-external --json visibility -q .visibility`. On
`Could not resolve to a Repository`, this is the first external recipe: make
the pack the way step 2 makes an app repo (ask first, then `gh repo create`
from `$TEMPLATE` with the secrets), but **public**, unlike an app: pass
`--public` in place of `--private`. Remove the template's placeholders, and give
it a `manifest.yaml` named `$COLLECTIVE/recipes-external` with
`visibility: public` (and the same in `ci.yml`), the `puddlerouter-recipe`
label, a README with an empty recipe table, and only `workflows:` (no models).
Step 7's visibility check still runs on it, and a failed required check still
stops it going public.

A recipe is a workflow with one `model_method` step and a `puddlerouterRecipe`
tag, like `workflows/workflow-github-open-prs.yaml` in the `puddlerecipes`
repo's `packs/github/`. On a branch of that repo: add it under `workflows/`,
list it in `manifest.yaml`, add the `puddlerouter-recipe` label if it is
missing, and add a row to the README's recipe table. Run its `make test`,
`make contracts-check` and `make guardrails-check`, run the workflow by hand
against a model definition of the extension, and for a recipe run
`@puddleworks/recipes` `match` and `execute` with each phrase in the spec. An
extension outside `@swamp/*`, `@mesgme/*`, `@webframp/*` and `@puddleworks/*`
also needs an `allow:` entry in the user's `puddlerouter.yaml`: say so, and
don't edit it. Then do steps 8 to 11 against that repo, asking before creating
a repo, opening the PR and publishing. The `result` workflow needs a draft, so
write the build-result/v1 by hand (`docs/contracts/build-result.md`):
`extension` is the package the workflow went into, `entryPointRef` the
workflow, `path` its file, and `repository` and `pullRequest` that repo's.

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
  is often too long. It must not start with `prefill-`, `build-result-`,
  `visibility-`, `readiness-`, `plan-review-` or `assessment-`: the Factory
  keeps those for its own records, and `render` refuses them. It must not be
  `git-status`, `git-log` or `git-branch` either: the app's recipe takes its
  name as its id, and the recipe engine drops a recipe whose id one of its own
  recipes has.
- `specification.purpose`: one bounded sentence.
- `specification.inputs`: what the person enters each run, each with `name`
  (camelCase), `type` (`string`, `number`, `integer` or `boolean`),
  `description`, and `required: true`, or `required: false` with a `default`.
  If `specification.recipe` has `pieces`, give each piece an input of its name.
  A required text input with no piece means no recipe can reach the app, so
  make it optional if a default will do, and say so if it can't. A required
  number with no piece blocks readiness until it gets one.
- `specification.output`: what one run produces.
- `specification.settings`: what the builder sets once (paths, tokens), each
  with `name` (camelCase), `description` and `sensitive` (true for secrets,
  which are then read with `vault.get()`). Empty is fine.
- `delivery.method`: usually `packaged_script`; `scheduled_workflow` if it runs
  on a timer; `external_app` or `manual_process` mean there is nothing to draft.

Before the user agrees these, check the request is still at the version it was
agreed at. Whoever handed over the spec may have revised it in the tool it came
from since, and that tool then refuses a build result for the old version, after
the whole build. This is the cheapest point to stop. Get the request's outcome
spec again the way you got `OUTCOME` (the same URL, or a new export from the
tool, such as Capture's `export_outcome_spec` or its request page), and save it
as `SP/outcome-spec.latest.json`. Factory shares no code with that tool, so it
reads only what the tool exports. Then:

```bash
jq -nr --slurpfile a SP/app-spec.json --slurpfile l SP/outcome-spec.latest.json '$a[0].source as $s | $l[0] as $n |
  if $s.version == null then "no agreed version to check against"
  elif $n.specification.version == $s.version and $n.agreement.specHash == $s.specHash
  then "still version \($s.version)"
  else "changed: this build is of version \($s.version) (\($s.specHash[:12])), the request is now at version \($n.specification.version) (\($n.agreement.specHash[:12]))\n" | halt_error(1)
  end'
```

`still version N` means go on. `changed: …`, or a tool that won't export it
because it is no longer agreed, means the request was revised: stop, tell the
user both versions, and ask whether to start again from the new one (step 1a
with it as `OUTCOME`) or wait. Don't build the old one. `no agreed version`
means the spec's `source` names none, so there is nothing to check.

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
gh repo view ORG/NAME --json visibility -q .visibility
```

`PRIVATE` or `PUBLIC` means it exists: use the user's checkout as `APP`, or
clone it (`gh repo clone ORG/NAME APP`). `Could not resolve to a
Repository` means it does not exist yet. Creating a repo is outward-facing, so
**ask first**, naming the repo and where the checkout goes (suggest
`$HOME/dev/NAME`). On yes:

```bash
gh repo create ORG/NAME --template $TEMPLATE --private --clone=false
gh repo clone ORG/NAME APP
if [ -n "$SECRETS" ]; then
  ID=$(gh api repos/ORG/NAME -q .id)
  for N in $(echo "$SECRETS"); do gh api -X PUT orgs/ORG/actions/secrets/$N/repositories/$ID; done
fi
```

The last lines give the repo the org secrets its CI publish dry run needs
(they are shared with selected repos only); with `secrets` empty they are
skipped. They need a token with `admin:org`; if `gh api` answers `403`, tell the
user to add the repo under **Repository access** at
`https://github.com/organizations/ORG/settings/secrets/actions` for each secret.

Every app starts private. Whether it goes public is decided at the end, once the
extension is built and checked. A clone straight after `gh repo create` can
come back empty while GitHub copies the template: if `git -C APP log` says
`does not have any commits yet`, wait a few seconds, delete `APP` and clone
again.

With `WT=git`, make the branch with a plain `git worktree add`, beside the checkout, and use
its path as `W`; on a re-draft, `git -C APP worktree list --porcelain` shows the
worktree on `draft/NAME`. Skip the Orca commands below.

```bash
git -C APP fetch origin --quiet
git -C APP worktree add ../NAME-draft -b draft/NAME origin/main
```

With `WT=orca`, every app is an Orca project, and every build happens in an Orca
worktree, so the user can see and open it from Orca. Add the checkout to Orca
(this is safe to repeat: an app already added gives back the same id) and make
the branch in a new Orca worktree:

```bash
ORCA_ID=$(orca repo add --path APP --json | jq -r .result.repo.id)
git -C APP fetch origin --quiet
orca worktree create --repo id:$ORCA_ID --name draft-NAME --branch draft/NAME \
  --base-branch origin/main --no-parent --setup skip --activate --json \
  | jq -r '.result.worktree.path'
```

The path it prints is `W`. Orca names the project after the remote
(`github:ORG/NAME`); `orca project list --json` shows it. Always pass
`--no-parent`: the build is not linked to any other worktree, and Orca would
otherwise pick a parent from where it was run. If the branch already exists,
this is a re-draft: find its worktree with
`orca worktree list --repo id:$ORCA_ID --json | jq -r '.result.worktrees[] | select(.branch == "refs/heads/draft/NAME") | .path'`
and reuse it as `W`, skip the clean-up below, and pass `overwrite=true` in
step 3 only if the user agrees to replace the files.

On a new branch, remove the template's placeholders so the draft replaces them,
and give the repo its own swamp `repoId`:

```bash
git -C W rm -q --ignore-unmatch manifest.yaml README.md extensions/models/example.ts \
  extensions/models/example_test.ts workflows/workflow-example.yaml 'swamp-extension-review/*.json'
{ head -1 W/contracts.ts; printf '\n// Maps each model instance a workflow reads with data.latest(...) to its type and the data names it writes.\nexport const CONTRACTS: Contracts = {};\n'; } > SP/contracts.ts
mv SP/contracts.ts W/contracts.ts
(cd W && swamp repo init --force --tool claude >/dev/null)
git -C W add -A
git -C W commit -q \
  -m "Remove the template placeholders"
```

`contracts.ts` keeps the template's `Contracts` import (and so its
puddle-tooling version) and loses the example entry. `swamp repo init --force`
only rewrites its own managed section of `CLAUDE.md`; the template's "Puddle
repo" section stays.

**Where you write.** From here on, change files only in `W` and `SP`, commit and
push only from `W`, and only to `draft/NAME` on `REPO`. Never edit, commit or
push in the Factory's own checkout, even to fix something you find in it: tell
the user, and leave Factory changes to separate work they ask for. Use `W`'s
real path (`W=$(realpath W)`): `render`, `visibility` and `readiness` refuse a
path through a symlink, a folder inside the checkout, a checkout of any repo
but `REPO`, and the Factory's checkout. They check only what they themselves
read and write, so these rules are yours to keep everywhere else.

## Step 3: Generate the skeleton

```bash
swamp workflow run @puddleworks/puddleworks-factory-build --input spec=SPEC --input targetDir=W --input repository=REPO --input branch=draft/NAME --json \
  | jq -r '.status + " " + ([.jobs[].steps[] | select(.status=="failed") | .error] | join(" | "))'
```

For inline JSON, quote it: `--input "spec=$(cat spec.json)"`. The draft is
private under `$COLLECTIVE/NAME` by default; going public is the last step,
after the build. The skeleton goes in the root of `W`: the extension, its test
and the workflow under `extensions/models/` and `workflows/`, plus
`manifest.yaml`, `README.md`, `LICENSE` and `.github/workflows/ci.yml` (the
template's are kept), and a marked app section in `CLAUDE.md` (added, or
replaced on a re-draft). If the spec has a `specification.recipe` that one method
call can answer, it also writes `workflows/workflow-NAME-recipe.yaml`, lists it
in the manifest and adds the `puddlerouter-recipe` label. Set its `each.line`
during the build, as the `CLAUDE.md` section says; readiness blocks until you do.
If it can't be answered that way, there is no recipe file and that section says
why. If the spec has a `source`, the draft copies its `url` and `version` into the
recipe tag; leave them as they are.

A recipe calls one method and has 10 s to answer, because the router gives up on
it at 15 s. If the build gives the entry point several steps, keep one method that
does them all by calling the code directly, and point the recipe at it. Never
start `swamp` on the same instance from a method: it waits on its own lock until
it fails. If that takes too long, or a step belongs to another extension, write a
method that answers from the latest stored result, and point the recipe at that.
Only a required input of free text means no recipe.

If the recipe's method changes nothing at all, add `effects-read` to the
manifest's labels. Be sure: the recipe then answers without asking first, and
readiness runs it to time it. Otherwise readiness doesn't run it, so time it
yourself on something safe.

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
| `the Factory's own checkout` / `inside the Factory's checkout` / `the Factory's own repo` | `targetDir` is the Factory, not the app | Point it at the app repo worktree from step 2; never draft into the Factory |
| `is a checkout of …, not …` / `has no GitHub origin`    | `targetDir`'s origin is not `REPO`             | Use the checkout of `REPO`, or fix `REPO`               |
| `goes through a symlink or '..'` / `is not the root of a git checkout` / `is a symlink` | `targetDir` is not the checkout's real root, or a draft path leads out of it | Pass `realpath W`; remove the symlink                   |
| `checked out, not draft/NAME`                           | Another branch is checked out in `W`           | `git -C W switch draft/NAME`                            |
| `repository "…" … Pass the plain https URL` | `repository` is not https, has a login, a query or fragment, or no path | Pass `REPO`, e.g. `https://github.com/ORG/NAME` |

Then commit the skeleton untouched (with `spec/` when it came from an outcome
spec), so review can tell generated code from written code:

```bash
git -C W add -A
git -C W commit -q \
  -m "draft: generated skeleton for NAME"
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

This is the first build result, not the last. If the spec came from Capture,
record it there now, as step 11 says, so the request shows Building while you
build.


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
guess.

Then have the plan reviewed by an agent that didn't write it. Start it with the
`Agent` tool, `subagent_type: "general-purpose"` (never `fork`, which carries
this conversation), with `SPEC` and `SP` filled in:

```text
Review a build plan before anything is built. You did not write it; judge it
only by the spec. Read SP/plan.md, SPEC, and W/spec/outcome-spec.v*.json (the
highest version) when there is one. Change no file.

Does the plan meet the spec: every acceptance criterion has a test or a
verification step, nothing is on the out-of-scope list, no input or setting is
renamed, added or removed? Is it a good plan? Start your reply with PASS or
CONCERNS on a line of its own, then say why in under 200 words.
```

Write its reply to `SP/plan-review.txt` and record it, with `VERDICT` as `pass`
or `concerns` from the reply's first line:

```bash
swamp workflow run @puddleworks/puddleworks-factory-plan-review --input name=NAME \
  --input plan=SP/plan.md --input verdict=VERDICT --input response=SP/plan-review.txt --json | jq -r .status
```

If the agent can't be started or gives no verdict, record `verdict=failed` with
the reason in the response file, or `verdict=pending` with no response if
you'll review it later. That doesn't stop the build. The review is advisory:
show the user the verdict and any concerns, and change the plan only if they
agree. Each change to `SP/plan.md` needs a new review. A review counts only for
the plan as it is now:

```bash
swamp data query "behavior(\"puddleworks-factory\") && name == \"plan-review-NAME\"" \
  --select content --json | jq -r --arg h "sha256:$(sha256sum SP/plan.md | cut -d' ' -f1)" \
  '.results[0] | if .planHash == $h then .verdict + ": " + .response else "no review of this plan yet" end'
```

Then carry straight on.

## Step 5: Build it test-first

Work in `W`. For each test in the plan: write it, run `make test` and see it
fail for the right reason, then write the code that makes it pass. If the tests
need Deno permissions (`--allow-read` and so on), add the same flags to the
"Test it" command in `W/README.md`, the `test` target of `W/Makefile` if it has
one, and the `deno test` lines of `W/.github/workflows/ci.yml`, so they all run
the same tests.

Then run the workflow once for real, as `W/README.md` says (create the model
instance, then `swamp workflow run <entryPointRef>`), with settings that work
on this machine. If a setting needs a credential the user has not given, ask
for it or skip the run, and say which in the report.

```bash
git -C W add -A
git -C W commit -q \
  -m "Build the NAME behaviour"
```

## Step 6: Get it through the checks

```bash
cd W
swamp extension fmt manifest.yaml
make test
make contracts-check
make guardrails-check
swamp workflow validate ENTRY_POINT_REF
swamp extension quality manifest.yaml --json \
  | jq '{percentage, gateFailures, provisional: [.factors[] | select(.status == "provisional") | .id]}'
```

`ENTRY_POINT_REF` is the full `@<collective>/<slug>` name from `W/README.md`;
the `model not found` warning from `validate` is expected in a fresh worktree.
Each must pass, with no `gateFailures` and every factor earned except the
`provisional` ones: fix the code (JSDoc on exports, a README, the licence)
until it is. A provisional factor, such as `repository-verified`, is awarded
only by the registry at push, so the local percentage stays below 100 (87%
with that one) however good the code is. The draft is not
formatted as generated, so `fmt` changes files the first time. Commit what
changed, as in step 5, with the message `Get NAME ready to publish`.

## Step 7: Recommend public or private, and ask

```bash
QJ=$(cd W && swamp extension quality manifest.yaml --json)
Q=$(jq .percentage <<<"$QJ"); PQ=$(jq '.ifProvisionalEarned.percentage // 0' <<<"$QJ")
RV=$(gh repo view ORG/NAME --json visibility -q .visibility | tr A-Z a-z)
swamp workflow run @puddleworks/puddleworks-factory-visibility --input name=NAME \
  --input quality=$Q --input provisionalQuality=$PQ --input repoVisibility=$RV --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "visibility-NAME"' \
  --select content --json | jq '.results[0] | {recommendation, canBePublic, checks, findings}'
```

Run this from the swamp repo from step 1, like the other Factory
workflows. The method reads every text file in `W` (not `.git`, `.swamp`,
`node_modules`, or skills the manifest doesn't ship) and gives the same answer
for the same files:

| Check              | Role     | Fails when                                                                   |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `licence`          | required | No `license:` in the manifest, or no `LICENSE` file                          |
| `repository`       | required | No `https://` `repository:` in the manifest                                  |
| `quality`          | required | Quality below 100%, even with the registry's provisional points              |
| `secrets`          | required | A key or token is in the files (its text is never shown)                     |
| `secrets-in-tests` | signal   | Something like a key or token is in test code                                |
| `internal-details` | signal   | Home paths, internal hosts, private IPs or real email addresses              |
| `audience`         | signal   | The spec's `specification` says it is internal, confidential, for "our team" |
| `repo-visibility`  | info     | The GitHub repo and the manifest disagree; decides nothing                   |

A failed `secrets` check means the secret is in git history: tell the user to
rotate it, and remove it before anything else. Look at each `secrets-in-tests`
finding: most are made-up fixtures, and a real one is a failed `secrets` check. Show the recommendation, every
check that failed, and each finding (`file:line` and its `text`, which is only
what matched, never the line; a secret's is `(hidden)`), then ask with
`AskUserQuestion`, the recommendation first.

**Always ask, every build, before step 8's dry run and the first publish.**
Visibility is permanent once pushed, so never decide it yourself, not even when
only one answer looks possible or the user has chosen before. Always offer both
**Public** and **Private**. When `canBePublic` is false, still offer Public, and
say in its description which required checks block it and what fixing them
takes; if the user picks it, fix them the way step 5 does, run step 6's checks,
and run this step again before changing the manifest. The `quality` check
counts the registry's provisional points (`provisionalQuality`), because the
repo is made public in step 10, before the push that awards them. If the
`secrets` detail lists files it did not read, say so: none of them was checked
for secrets.

Never show a finding's line yourself, by opening the file: it may hold a secret
that no pattern knows.

Set the visibility **now**, before the review report: the report is bound to
the content hash, and the manifest is part of it. Never pass `--visibility` to
`swamp extension push`; it changes the hash too. For **private**, the manifest
and `ci.yml` already say `private`. For **public**, after the user's answer:

```bash
perl -pi -e 's/^visibility: private$/visibility: public/' W/manifest.yaml
perl -pi -e 's/visibility: private # must equal/visibility: public # must equal/' W/.github/workflows/ci.yml
grep -n '^visibility:' W/manifest.yaml; grep -n 'visibility:' W/.github/workflows/ci.yml
git -C W commit -q -am "Publish NAME publicly"
```

Expect `visibility: public` from both greps. The GitHub repo itself is made
public in step 10, with the push. `V` below is the chosen visibility.

## Step 8: Have a fresh agent review it

You built it, so you do not review it. A fresh agent that has seen none of the
build reads only the spec and the repo, writes the review report, and maps each
acceptance criterion to the tests that check it. It changes no code.

Clear out reports from earlier rounds, then get the report path and skeleton
from a dry run:

```bash
cd W
rm -f swamp-extension-review/*.json
mkdir -p swamp-extension-review
SWAMP_EXTENSION_REVIEW_DIR=$(pwd) swamp extension push manifest.yaml --dry-run --json \
  | jq '.warnings.review[] | select(.ruleId == "adversarial-review-report") | {file, skeleton}' > SP/review.json
jq -r .file SP/review.json
```

Expect a path under `W/swamp-extension-review/`. Start the reviewer with the
`Agent` tool, `subagent_type: "general-purpose"`. Never `fork`: a fork carries
this conversation, which is exactly what the reviewer must not see. Fill in
`W`, `SPEC` and `SP`, and send this as the prompt:

```text
Review a swamp extension before it is published. You did not build it; judge
it only by the spec and the repo.

Repo: W (a git worktree; do not commit, push or change any code or spec).
Spec: SPEC, and every file in W/spec/. The agreed request is
W/spec/outcome-spec.v*.json (the highest version) when there is one.
Read nothing else outside W except SP/review.json.

1. Run `make test` in W, and read the code, tests, workflow, manifest and
   README.
2. Load the swamp skill and follow its
   references/extension/references/adversarial-review.md: the mechanical
   checks, then every dimension in the skeleton.
3. Check the build stays within the spec: inputs and settings as the spec names
   them, nothing on the out-of-scope list, no permissions or secrets the
   settings do not name.
4. For each acceptance criterion in the outcome spec, read the test bodies and
   list the tests that really check it (a matching name is not enough). If no
   test does, check it yourself if you can (for example run the workflow as
   W/README.md says) and say in "manual" what you ran and saw; otherwise leave
   both empty. Write W/spec/acceptance.json:
   {"criteria": [{"id": "AC1", "tests": ["exact Deno.test name"], "manual": ""}]}
   Skip this step if there is no outcome spec.
5. Write the .skeleton from SP/review.json to the path in its .file, with
   reviewedAt set to now and every dimension's verdict set to pass, na or
   issue, each with a note saying what you checked. Leave none pending.

Reply in under 300 words: each issue verdict, each scope problem, each
criterion with no test or manual check, and anything else the builder must fix.
Say "no findings" if there are none.
```

When it replies, check what it wrote:

```bash
F=$(jq -r .file SP/review.json)
swamp workflow run @puddleworks/puddleworks-factory-readiness --input name=NAME --input review=$F --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "readiness-NAME"' \
  --select content --json | jq -r '.results[0] | .ready, .summary'
```

Run it from the swamp repo from step 1. It changes nothing in `W`, and gives the
same answer for the same files. When the spec has a recipe, it also sends each
phrase through `@puddleworks/recipes` in a throwaway swamp repo, so it needs
network access, and `Recipe:` in the summary says how many passed. There it also
loads the app, to see the recipe's method exists. If the manifest says
`effects-read`, it runs the app for each phrase and times it, so that part of the
answer can change between runs; if not, `Recipe:` says the speed wasn't timed.
`false` lists the blockers in the summary (the first six; `.blockers` has them
all):

- `The review report could not be read`, or it is for another name or
  version: run this step again.
- `Review issue, <dimension>`, or a dimension with no verdict: fix it, then run
  this step again.
- `<id> is not in spec/acceptance.json`, or `<id> has no test and no manual
  check`: write the test the criterion needs, then run this step again.
- `names a test that is not in any *_test.ts`: the reviewer misnamed it; run
  this step again.
- `The visibility check has not run`, or the manifest says public when its
  required checks failed: run step 7 again.
- `each.line is still the draft's`: set it in the recipe workflow's tag, as the
  app's `CLAUDE.md` says, commit, and run this step again.
- `The recipe does not answer "<phrase>"`: widen the tag's `pattern`, or fix what
  the detail says, and run this step again. Never drop a phrase to pass.
- `No recipe answers the phrases`, or the manifest lacks the file or the
  `puddlerouter-recipe` label: put them back. If the draft wrote none, the
  blocker says why: write the recipe by hand, as the app's `CLAUDE.md` says, or
  change the spec. Only an input of free text means no recipe: then delete the
  recipe file so `Recipe: none` says why.
- `The entry point ... has N steps`: give it one method that does them all, or
  one that answers from the latest stored result, and point a recipe at it, as
  the app's `CLAUDE.md` says.
- `The recipe "..." calls the method`: the app doesn't have that method. Fix the
  recipe workflow's `methodName`, or put the method back.
- `The recipe took ... s` or `did not finish`: it is too slow for the router. Add
  a method that answers from the latest stored result, and point the recipe at it.
- `The recipe could not be checked`: swamp or the network failed, not the app;
  read the message and run this step again.

`true`, with no scope problems in the reply, means go on to step 9. Otherwise
fix each finding the way step 5 does (test first), run step 6's checks, commit
with the message `Fix review findings for NAME`, and, if any file changed, run
step 7's visibility workflow again (ask again only if its answer changed). Then
repeat this step with a **new** agent; never send the fix back to the old one.
If it is still not ready after two rounds, stop and show the user the blockers.

## Step 9: Open the PR

```bash
cd W
make publish VISIBILITY=V DRY_RUN=1
```

Expect `dry run only; nothing was pushed`, after the tests, `deno check`,
`fmt --check`, the quality gate and a dry run with no warnings. A
`declares visibility` error means step 7's change was not committed; an
`adversarial-review` warning means the code changed after the review, so run
step 8 again. Commit the report and the criteria map, push, and open the PR to
the app repo:

```bash
git -C W add swamp-extension-review/ spec/
git -C W commit -q \
  -m "Review NAME for publishing"
git -C W push -u origin draft/NAME
gh pr create --repo ORG/NAME --head draft/NAME --base main \
  --title "Build NAME" --body-file SP/pr.md
```

`SP/pr.md` says what was built, how it was tested (and whether the real run in
step 5 happened), the visibility and why, that a fresh agent reviewed it and
how many rounds it took, then the readiness `summary` in a code block, and ends
with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The
PR's CI runs the same publish dry run, so it is green only with the report
committed.

## Step 10: Publish, once the user confirms

Publishing is outward-facing, and a public package or repo may be cached even
if it is changed back later. Check readiness once more, now with the PR and the
commit that would be published:

```bash
F=$(jq -r .file SP/review.json)
swamp workflow run @puddleworks/puddleworks-factory-readiness --input name=NAME --input review=$F \
  --input pullRequest=PR_URL --input commit=$(git -C W rev-parse HEAD) --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "readiness-NAME"' \
  --select content --json | jq -r '.results[0] | .ready, .summary'
```

Then check the request is still at the agreed version, as in step 1a: get its
outcome spec again into `SP/outcome-spec.latest.json`, and run:

```bash
jq -nr --slurpfile a W/spec/app-spec.json --slurpfile l SP/outcome-spec.latest.json '$a[0].source as $s | $l[0] as $n |
  if $s.version == null then "no agreed version to check against"
  elif $n.specification.version == $s.version and $n.agreement.specHash == $s.specHash
  then "still version \($s.version)"
  else "changed: this build is of version \($s.version) (\($s.specHash[:12])), the request is now at version \($n.specification.version) (\($n.agreement.specHash[:12]))\n" | halt_error(1)
  end'
```

This is the last point to stop before anything is pushed to the registry. On
`changed: …`, don't publish: tell the user both versions and stop, as the build
is of a version that is no longer agreed. Updating it to the new version is a
new build. Skip this for an app spec with no `source`.

Ask only if readiness says `true` and the request is still at its version. Show
the `summary` exactly as it is, in a code
block: the package and version, the visibility against the recommendation, the
PR and commit, the review's verdicts, and each acceptance criterion with its
tests. Add that it is published from that commit on `draft/NAME`, before the PR
is merged. Then ask with `AskUserQuestion`; on yes, run this from the swamp repo from step
1. `VERSION` is the version in the summary:

```bash
gh repo edit ORG/NAME --visibility public --accept-visibility-change-consequences   # public only
(cd W && make publish VISIBILITY=V) &&
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=$(git -C W rev-parse HEAD) --input pullRequest=PR_URL \
  --input publishedVersion=VERSION --input publishedVisibility=V \
  --input out=SP/NAME.build-result.json --json | jq -r .status
```

Expect `published $COLLECTIVE/NAME@VERSION (HASH)`, then `succeeded`. The
build result is written as the last command of the publish, so it is never
forgotten: until it is, the Factory page still shows the app as ready to
publish, and the tool the spec came from doesn't know it was published. Its
`buildRef` is the commit that was reviewed and published, not `draft/NAME`: the
branch can move after the publish, or go when the PR is merged.

`make publish` never passes `--yes`; the clean dry run is its gate. If it stops,
nothing is recorded: read what it lists, fix it, and repeat from step 8 (the
report must match the new hash). A version that is already published needs a
new `version:` in the manifest, which also means a new review. If the publish
worked but the result did not (`Pass publishedVersion and publishedVisibility
together` means one was left out), run only the `swamp workflow run` command
again, before committing anything in `W`.

## Step 11: Report

Step 10 wrote the build result. If the user stopped before publishing, write
it now with the PR but nothing published, so it still points at the branch:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=draft/NAME --input pullRequest=PR_URL \
  --input out=SP/NAME.build-result.json --json | jq -r .status
```

The last step is to record the file against the request, in Capture. Factory
doesn't call Capture; you run Capture's own method, from the swamp repo that
holds its instance (`capture` in Capture's README), with the file's full path
and the email of the outcome owner or a builder:

```bash
swamp behavior run CAPTURE record_build_result --input as=EMAIL \
  --input result=SP/NAME.build-result.json
```

Capture finds the request from the result's `source.url`, and refuses a result
whose `source.version` and `source.specHash` aren't the agreed version's. A
build from a hand-written app spec has no `source`, so it can't be recorded in
Capture at all: say so to the user, rather than treating it as a failure. If
Capture refuses the version, the request was revised during the build; tell the
user, and don't edit the result to fit.

Tell the user: the package and version, its visibility and why, the PR (which
they merge), the build result file and whether Capture took it, how long the
run took, and anything
skipped (the real run, a check). The build result takes `examples` from the
last readiness check, which shows a phrase reaches the app without running it,
and each passed example's `detail` says whether the app ran. So say if a recipe's
answers were not tried for real, and if `Recipe: none` says there is no recipe,
say why. If the spec had a `source`, the build result
names the request, version and hash, so it can be matched to the request later.

## Revising an app that is already built

When an agreed outcome spec is a newer version for a request that already has
an app (see Input), don't draft a new skeleton: that would replace the finished
code. Change the existing app on a branch instead, from a change plan.

Make the branch from the app's `main`, as step 2 does, but name it
`revise/NAME-vN` (`N` is the export's `specification.version`), and use its
worktree as `W`. Skip the template clean-up. Then, from the swamp repo of step 1:

```bash
swamp workflow run @puddleworks/puddleworks-factory-revise --input name=NAME \
  --input outcomeSpec=OUTCOME --input targetDir=W --json \
  | jq -r '.status + " " + ([.jobs[].steps[] | select(.status=="failed") | .error] | join(" | "))'
```

`succeeded` means it wrote `W/spec/outcome-spec.vN.json` and
`W/spec/change-plan.vN.md`, and brought `W/spec/app-spec.json`'s `source`,
out-of-scope list and recipe phrases up to version `N`. It changes no code,
tests, manifest or docs. On `failed`: `is for request` means the export is for
another request; `already meets version` means the app is at that version or
newer; `No draft` means this swamp repo's model didn't build the app, so run it
from the one that did.

Commit what it wrote untouched, so the diff shows the spec change and the plan:

```bash
git -C W add spec/
git -C W commit -q -m "Take NAME to spec version N"
```

Show the user the plan. If it changes inputs, settings, output or delivery,
agree them with the user and write them into `W/spec/app-spec.json`, as step 1a
does. Then do step 4 with the plan as its starting point, and steps 5 to 11,
changing the finished code only where the plan says. Update the app's section
of `W/CLAUDE.md` and `W/README.md`, and give the manifest a new `version:`.
Wherever a step says `draft/NAME`, use the revision branch. The build result
names version `N` and its hash, which is what Capture checks.

### Proposing a revision from the build side

If building shows the agreed spec has to change, propose the change in Capture
rather than building past it. Edit `W/spec/outcome-spec.vN.json` (the highest
version), and in the swamp repo where Capture runs, run its
`revise_specification` method with `outcomeSpec` set to that file's
**absolute** path (Capture reads a relative path from its own repo), a
one-sentence `reason`, and `as` the builder's email. The builder must already be
on the request in Capture. Capture saves it as version `N+1` with the reason
and proposes it to the outcome owner. Once they agree it and it is exported,
revise the app from that export as above.
