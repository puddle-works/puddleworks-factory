---
name: factory-build
description: >
  Take an agreed outcome spec (puddleworks.dev/outcome-spec/v1) or a
  puddleworks.dev/app-spec/v1 spec (a file path, an https URL or inline JSON)
  to a published swamp extension in one run: for an outcome spec, check
  whether an existing extension or recipe already does it, then prefill an
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

Take an agreed spec to a published extension in its own repo, aiming for
about an hour. Quality comes from checks that must pass, not from extra steps.
Where the repo goes and how it is built are settings (see Settings).

## The run at a glance

Do the steps in this order. The stages are those of
`docs/factory-quality-and-gates-plan.md` in the puddleworks-factory repo.

| Step | Stage                   | What happens                                                                  | Stop for the user                      |
| ---- | ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| 1    | Intake and reuse        | Make sure the factory model exists                                            |                                        |
| 2    | Intake and reuse        | Outcome spec only: check whether an existing extension or recipe already does it | Act on the verdict?                 |
| 3    | Agree and select target | Outcome spec only: prefill an app spec and agree it                           | Every open field; the version changed  |
| 4    | Agree and select target | Make the app's repo from the template, and the `draft/NAME` branch            | Before creating a repo                 |
| 5    | Generate and implement  | Generate the skeleton, push it, write the first build result                  |                                        |
| 6    | Generate and implement  | Plan the build, and have the plan reviewed                                    |                                        |
| 7    | Generate and implement  | Build the behaviour test-first                                                |                                        |
| 8    | Validate                | Format, tests, contracts, guardrails and quality all pass                     |                                        |
| 9    | Decide visibility       | Recommend public or private                                                   | Always: public or private              |
| 10   | Independent review      | A fresh agent reviews it; readiness checks nothing is left                    | Still not ready after two rounds       |
| 11   | PR and publication      | Open the PR to the app repo                                                   |                                        |
| 12   | PR and publication      | Publish, and write the build result with what was published                   | Confirm the summary; the version changed |
| 13   | Record                  | Record the build result in the tool the spec came from, and report            |                                        |

Two other paths replace part of this run: **Reusing an existing extension**
(after step 2, when the user acts on a reuse verdict) and **Revising an app that
is already built** (a newer version of a request that already has an app).

**Finished** means the extension is published at the version the readiness
summary names, the PR is open for the user to merge, and the build result from
step 12 is recorded against the request. In Capture the request then waits at
Building for its outcome owner's router test; step 13 says so.

Creating a repo, making it public and pushing to the registry are outward
steps: ask before each one. Never merge the PR; the user does.

The order is kept by following these steps; nothing enforces it yet.
ADR-002 chose `@swamp/stagecraft` to run the stages, and
`docs/stagecraft/factory-build.yaml` is its definition, but this skill does not
drive it (issue #47 in the puddleworks-factory repo). Don't install or run
Stagecraft for a build.

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

Shell variables don't last between Bash calls, so run this block again, from
the swamp repo root (not an app worktree, where it falls back to the defaults),
at the start of every Bash call that uses `$ORG`, `$TEMPLATE`, `$SECRETS`,
`$COLLECTIVE` or `$WT`, with the user's `/factory-build` arguments in the first
line every time. If it stops, show the user its message and wait for the file or
the arguments to be fixed. Don't carry on with the defaults.

The template must give each app a `Makefile` with `test`, `contracts-check`,
`guardrails-check` and `publish` targets, and a `contracts.ts`.

Commits in the app repo use the `user.email` step 4 sets there, the builder's
GitHub no-reply address, and end with whatever attribution the user's
instructions ask for, naming people by name or a no-reply address only: step
9 refuses any other address in the commits main does not have yet.

## Input

The spec: a file path, an `https://` URL, or the JSON itself. Ask for it if the
user did not give one.

The app repo: each app gets its own repo, `ORG/NAME`, made from `$TEMPLATE`.
`APP` is the absolute path of its checkout: one the user names, or the one
step 4 makes.

Check which kind of spec it is:

```bash
jq -r '.format // .apiVersion' SPEC_FILE   # or: curl -fsSL SPEC_URL | jq -r '.format // .apiVersion'
```

- `puddleworks.dev/outcome-spec/v1`: an agreed request
  (`docs/contracts/outcome-spec.md`). It says what success looks like, not how
  to build it. Do every step: step 2 checks for reuse, and step 3 turns it into
  an app spec.
- `puddleworks.dev/app-spec/v1`: already an app spec
  (`docs/contracts/app-spec.md`). Its `name` is the app name. Skip steps 2
  and 3.

An outcome spec at version 2 or more may be for a request that already has an
app: its Capture page lists a build result with the repo. Check with
`jq -r .request.id APP/spec/outcome-spec.v1.json`, which must equal the
export's `request.id` (the `request.url` may differ). If it does, follow
**Revising an app that is already built** below instead of steps 2 to 5.

Below:

- `SP` is this run's scratch folder: `$HOME/.factory-build/ID`, where `ID` is
  the outcome spec's `request.id` (`jq -r .request.id` on the file, or on
  `curl -fsSL URL` for a URL), or the app spec's `name`. `mkdir -p` it first and
  always write it absolute. It holds the plan, the review files and each build
  result (`SP/NAME.build-result.json`); never put it in `W`, which the
  visibility check reads in full.
- `DESK` is the swamp repo the router runs in, where `@puddleworks/recipes` is
  installed (usually also where Capture runs); ask the user if they have not
  said. `swamp extension list --repo-dir DESK --json | jq -r '.extensions[].name'`
  must list `@puddleworks/recipes`.
- `NAME` is the app name, `SPEC` is the app spec to build from, `REPO` is the
  app repo's https URL (`https://github.com/ORG/NAME`), and `W` is the worktree
  step 4 makes for the build (with Orca,
  `~/orca/workspaces/NAME/draft-NAME`; with git, `NAME-draft` beside `APP`).
- The contracts are in `docs/contracts/` in the puddleworks-factory repo.

**When the spec came from Capture**, take Capture's own commands from the
builder quick start (`QUICKSTART.md` in builder-workbench, the repo you run
/factory-build from), under `## Capture steps`: `### Get the spec again to check
the version` for steps 3 and 12, `### Record a build result` for steps 5 and 13
and the reuse paths, and `### Propose a revision`. This skill doesn't repeat
them. For a spec from another tool, use that tool's own way to export a request
and to record a result.

## Step 1: Make sure the factory model exists

Run swamp from the swamp repo where `@puddleworks/puddleworks-factory` is
installed, the one you run /factory-build from. Check for the model instance:

```bash
swamp model get puddleworks-factory --json 2>&1 | jq -r '.type // .error'
```

`@puddleworks/puddleworks-factory/draft` means it exists.
`Model not found: puddleworks-factory` means create it once:

```bash
swamp model create @puddleworks/puddleworks-factory/draft puddleworks-factory --global-arg "typeScope=\\$COLLECTIVE" --json | jq -r .type
```

A Factory workflow below that prints no status at all didn't run (this has
happened straight after swamp updated itself). Confirm with
`swamp workflow history get WORKFLOW --json | jq -r '[.id, .status, .startedAt // ""] | join(" ")'`,
`WORKFLOW` being its `@puddleworks/...` name, and run it once more. If it prints
nothing again, stop and tell the user, with `swamp --version`.

## Step 2: Check whether an existing extension already does it

Do this for an outcome spec, before step 3 and before any repo is made. An app
spec has already been through it; skip to step 4.

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

Check for a recipe already written too. Recipes are read in `DESK` (its
recipes model is usually named `recipes`), so every recipes command passes both
`--repo-dir DESK` and `--input repoDir=DESK`: without the input, they read
`puddlerouter.yaml` and pull packs in the folder you run from. Refresh the
index of every pack labelled `puddlerouter-recipe`:

```bash
swamp workflow run @puddleworks/recipes-sync --repo-dir DESK --input repoDir=DESK --json | jq -r .status
```

Expect `succeeded`. Then for each phrase in the spec's `recipe.examples`:

```bash
swamp behavior run recipes match --repo-dir DESK --input repoDir=DESK --input "text=PHRASE" --json >/dev/null
swamp data query 'behavior("recipes") && name == "match"' --repo-dir DESK \
  --select content --json | jq -c '.results[0] | {matched, recipeId}'
```

That covers the built-in recipes, every pack and the desk's
`puddlerouter.yaml`. Write one line per phrase to `SP/matches.json`, with
`extension` the one the recipe's tag names:

```json
[{"phrase": "open prs in acme/widgets", "recipe": "github-open-prs", "extension": "@webframp/github"},
 {"phrase": "does this repo have a licence", "recipe": null, "extension": null}]
```

Write the candidates to `SP/candidates.json` (`[]` if the search found nothing):

```json
[{"extension": "@webframp/github", "type": "@webframp/github", "method": "get_repo_info",
  "checks": {"wholeJob": false, "readOnly": true, "inputs": true, "settings": true, "output": false},
  "note": "covers only a named GitHub repo; no file path"}]
```

Then record the verdict, with `A` a short lowercase name for the request (the
app name you would suggest in step 3):

```bash
swamp workflow run @puddleworks/puddleworks-factory-assess --input outcomeSpec=OUTCOME \
  --input candidates=SP/candidates.json --input matches=SP/matches.json \
  --input delivery=DELIVERY --input name=A --json | jq -r .status
swamp data query 'behavior("puddleworks-factory") && name == "assessment-A"' \
  --select content --json | jq '.results[0] | {verdict, reason, chosen, matches, candidates: [.candidates[] | {extension, method, owner, failed}]}'
```

Leave out `--input matches=…` when the spec has no recipe examples; with
examples, a phrase with no line in it stops the run. Show the user the verdict,
its reason, the recipe each phrase matched and each candidate with the checks it
failed, and ask with `AskUserQuestion` whether to act on it; choosing someone
else's extension over a new build is their call.

- `build-functionality`, or a no to any verdict: go on to step 3.
- A yes to `done`, `recipe-in-our-extension`, `recipe-in-pack`,
  `workflow-in-our-extension` or `workflow-app`: build no app. Follow
  **Reusing an existing extension** below instead of steps 3 to 12.

## Step 3: Prefill an app spec from an outcome spec

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

- `name`: short, lowercase, hyphens; the suggested slug is often too long.
  `render` refuses one starting `prefill-`, `build-result-`, `visibility-`,
  `readiness-`, `plan-review-` or `assessment-` (the Factory's own records),
  and the recipe engine drops `git-status`, `git-log` and `git-branch`, its own
  recipe ids, which the app's recipe would take.
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
spec again the way you got `OUTCOME`, and save it as
`SP/outcome-spec.latest.json`. From Capture, the quick start's `### Get the
spec again to check the version` writes that file; from a URL, fetch it again.
Factory shares no code with that tool, so it reads only what the tool exports.
Then, with `A` the app spec (step 12 runs this again with `W/spec/app-spec.json`):

```bash
A=SP/app-spec.json
jq -nr --slurpfile a "$A" --slurpfile l SP/outcome-spec.latest.json '$a[0].source as $s | $l[0] as $n |
  if $s.version == null then "no agreed version to check against"
  elif $n.specification.version == $s.version and $n.agreement.specHash == $s.specHash
  then "still version \($s.version)"
  else "changed: this build is of version \($s.version) (\($s.specHash[:12])), the request is now at version \($n.specification.version) (\($n.agreement.specHash[:12]))\n" | halt_error(1)
  end'
```

`still version N` means go on. `changed: …`, or a tool that won't export it
because it is no longer agreed, means the request was revised: stop, tell the
user both versions, and ask whether to start again from the new one (step 3
with it as `OUTCOME`) or wait. Don't build the old one. `no agreed version`
means the spec's `source` names none, so there is nothing to check.

Use `AskUserQuestion` for choices with real alternatives, and wait for the user
to confirm or change every field. Do not build on your own guesses. Write the
agreed values into `SP/app-spec.json` (keep `source` as it is), then check it:

```bash
jq -e '.name and .specification.output != "" and .delivery.method != ""' SP/app-spec.json
```

`NAME` is now the agreed `name`. After step 4, both specs are kept beside the
skeleton, so the build can always be traced back to what was agreed. The app
repo may be public one day, so the outcome spec is kept with every person's
email blank; names stay, and `agreement.specHash` covers only `specification`,
so the copy still matches the agreed version:

```bash
mkdir -p W/spec
jq '.agreement.agreedBy.email = "" | .participants |= map(.email = "")' OUTCOME \
  > W/spec/outcome-spec.v$(jq -r .specification.version OUTCOME).json
cp SP/app-spec.json W/spec/app-spec.json
```

In step 5, `SPEC` is `W/spec/app-spec.json`.
The build checks it fully: a field left blank fails there with
`is not a valid puddleworks.dev/app-spec/v1 spec`.

## Step 4: Make the app repo and a branch in it

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

The last lines grant the org secrets CI's publish dry run needs (skipped when
`secrets` is empty). They need a token with `admin:org`; on `403`, tell the user
to add the repo under **Repository access** at
`https://github.com/organizations/ORG/settings/secrets/actions` for each secret.
Every app starts private; visibility is decided in step 9, and every app is
checked as if public whichever is chosen. Make every commit in it name the
builder by their GitHub no-reply address, never a real one (worktrees share
this setting):

```bash
git -C APP config user.email "$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
git -C APP config user.email
```

Expect `<digits>+<login>@users.noreply.github.com`. If `git -C APP log`
says `does not have any commits yet`, GitHub is still copying the template:
wait a few seconds, delete `APP` and clone again.

With `WT=git`, make the branch with a plain `git worktree add`, beside the checkout, and use
its path as `W`; on a re-draft, `git -C APP worktree list --porcelain` shows the
worktree on `draft/NAME`. Skip the Orca commands below.

```bash
git -C APP fetch origin --quiet
git -C APP worktree add ../NAME-draft -b draft/NAME origin/main
```

With `WT=orca`, add the checkout to Orca as a project, so the user can open the
build from Orca (repeating it gives back the same id), and make the branch in a
new Orca worktree:

```bash
ORCA_ID=$(orca repo add --path APP --json | jq -r .result.repo.id)
git -C APP fetch origin --quiet
orca worktree create --repo id:$ORCA_ID --name draft-NAME --branch draft/NAME \
  --base-branch origin/main --no-parent --setup skip --activate --json \
  | jq -r '.result.worktree.path'
```

The path it prints is `W`. Always pass `--no-parent`, or Orca links the build
to a parent worktree picked from where it was run. If the branch already exists,
this is a re-draft: find its worktree with
`orca worktree list --repo id:$ORCA_ID --json | jq -r '.result.worktrees[] | select(.branch == "refs/heads/draft/NAME") | .path'`
and reuse it as `W`, skip the clean-up below, and pass `overwrite=true` in
step 5 only if the user agrees to replace the files.

On a new branch, remove the template's placeholders so the draft replaces them,
and give the repo its own swamp `repoId`:

```bash
git -C W rm -q --ignore-unmatch manifest.yaml README.md extensions/models/example.ts \
  extensions/models/example_test.ts workflows/workflow-example.yaml 'swamp-extension-review/*.json'
{ head -1 W/contracts.ts; printf '\n// Maps each model instance a workflow reads with data.latest(...) to its type and the data names it writes.\nexport const CONTRACTS: Contracts = {};\n'; } > SP/contracts.ts
mv SP/contracts.ts W/contracts.ts
(cd W && swamp repo init --force --tool claude >/dev/null)
git -C W add -A
git -C W commit -q -m "Remove the template placeholders"
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

## Step 5: Generate the skeleton

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

A recipe calls one method and has 10 s to answer (the router gives up at 15 s).
Keep one method that does all the entry point's steps by calling the code
directly; never start `swamp` on the same instance from a method, which waits on
its own lock until it fails. If that is too slow, or a step belongs to another
extension, point the recipe at a method that answers from the latest stored
result. Only a required input of free text means no recipe. Add `effects-read`
to the manifest's labels only if the method changes nothing at all: the recipe
then answers without asking, and readiness runs it to time it; otherwise time it
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
| `does not look like an app repo checkout`               | `targetDir` has no `.swamp.yaml`               | Point it at the app repo worktree from step 4           |
| `the Factory's own checkout` / `inside the Factory's checkout` / `the Factory's own repo` | `targetDir` is the Factory, not the app | Point it at the app repo worktree from step 4; never draft into the Factory |
| `is a checkout of …, not …` / `has no GitHub origin`    | `targetDir`'s origin is not `REPO`             | Use the checkout of `REPO`, or fix `REPO`               |
| `goes through a symlink or '..'` / `is not the root of a git checkout` / `is a symlink` | `targetDir` is not the checkout's real root, or a draft path leads out of it | Pass `realpath W`; remove the symlink                   |
| `checked out, not draft/NAME`                           | Another branch is checked out in `W`           | `git -C W switch draft/NAME`                            |
| `repository "…" … Pass the plain https URL` | `repository` is not https, has a login, a query or fragment, or no path | Pass `REPO`, e.g. `https://github.com/ORG/NAME` |

Then commit the skeleton untouched (with `spec/` when it came from an outcome
spec), so review can tell generated code from written code:

```bash
git -C W add -A
git -C W commit -q -m "draft: generated skeleton for NAME"
git -C W push -u origin draft/NAME
```

Then write the build result (`puddleworks.dev/build-result/v2`, see
`docs/contracts/build-result-v2.md` in the puddleworks-factory repo), so whoever
handed over the spec can see where the build went. The repository is the one
the draft was built with:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=draft/NAME --input out=SP/NAME.build-result.json --json | jq -r .status
```

Expect `succeeded`. `No draft of "NAME" has been rendered` means the generate
step above did not run on this swamp repo's `puddleworks-factory` model.

This is the first build result, not the last. If the spec came from Capture,
record it there now, as step 13 says, so the request shows Building while you
build.

## Step 6: Plan the build

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
the reason in the response file, or `verdict=pending` with none to review later;
neither stops the build. The review is advisory: show the user the verdict and
any concerns, and change the plan only if they agree. A review counts only for
the plan as it is now, so each change needs a new one:

```bash
swamp data query "behavior(\"puddleworks-factory\") && name == \"plan-review-NAME\"" \
  --select content --json | jq -r --arg h "sha256:$(sha256sum SP/plan.md | cut -d' ' -f1)" \
  '.results[0] | if .planHash == $h then .verdict + ": " + .response else "no review of this plan yet" end'
```

Then carry straight on.

## Step 7: Build it test-first

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
git -C W commit -q -m "Build the NAME behaviour"
```

## Step 8: Get it through the checks

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
with that one) however good the code is. The skeleton's code is generated
already formatted, so `fmt` changes only what you wrote in step 7. Commit what changed,
as in step 7, with the message `Get NAME ready to publish`.

## Step 9: Recommend public or private, and ask

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
`node_modules`, or skills the manifest doesn't ship), and the author, committer
and trailers of each commit in `W` that `origin/main` does not have yet, and
gives the same answer for the same files and commits. Every app is checked as if
public, since a private repo can be made public later: step 12's readiness
check refuses a **private** app whose required checks fail, too.

| Check              | Role     | Fails when                                                                   |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `licence`          | required | No `license:` in the manifest, or no `LICENSE` file                          |
| `repository`       | required | No `https://` `repository:` in the manifest                                  |
| `quality`          | required | Quality below 100%, even with the registry's provisional points              |
| `secrets`          | required | A key or token is in the files (its text is never shown)                     |
| `emails`           | required | An email in the files or new commits, except example, no-reply, tool ones    |
| `internal-details` | required | Home paths, internal hosts or private IPs in the files, tests included       |
| `secrets-in-tests` | signal   | Something like a key or token is in test code                                |
| `audience`         | signal   | The spec's `specification` says it is internal, confidential, for "our team" |
| `repo-visibility`  | info     | The GitHub repo and the manifest disagree; decides nothing                   |

A failed `secrets` check means the secret is in git history: tell the user to
rotate it, and remove it before anything else. Look at each `secrets-in-tests`
finding: most are made-up fixtures, and a real one is a failed `secrets` check.
Fix a failed `emails` or `internal-details` check before going on, whichever
visibility the user wants: use `example.com` addresses, `~`, `*.example` hosts
and documentation IPs such as `192.0.2.1` in fixtures and docs. A commit finding
names the commit and where (`commit abc1234 (author)`): set `user.email` as in
step 4, and amend or rebase the commits on `draft/NAME` that `origin/main` does
not have yet, before anything is pushed.
Show the recommendation, every check that failed, and each finding (`file:line` and its `text`, which is only
what matched, never the line; a secret's is `(hidden)`), then ask with
`AskUserQuestion`, the recommendation first.

**Always ask, every build, before step 10's dry run and the first publish.**
Visibility is permanent once pushed, so never decide it yourself, even when one
answer looks certain. Always offer both **Public** and **Private**. When `canBePublic` is false, still offer Public, and
say in its description which required checks block it and what fixing them
takes; if the user picks it, fix them the way step 7 does, run step 8's checks,
and run this step again before changing the manifest. The `quality` check
counts the registry's provisional points (`provisionalQuality`), because the
repo is made public in step 12, before the push that awards them. If the
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
public in step 12, with the push. `V` below is the chosen visibility.

## Step 10: Have a fresh agent review it

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
   W/README.md says) and record it in "manual" as {"check": what you ran and
   saw, "by": "independent reviewer", "passed": true or false} (a role or a
   name in "by", never an email); otherwise leave
   "manual" out. Write W/spec/acceptance.json, one entry per criterion:
   {"criteria": [{"id": "AC1", "tests": ["exact Deno.test name"]}]}
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
phrase through `@puddleworks/recipes` in a throwaway swamp repo (so it needs
network access), loads the app to see the recipe's method exists, and, only if
the manifest says `effects-read`, runs and times the app for each phrase;
`Recipe:` in the summary says how that went. `false` lists the blockers (the
first six; `.blockers` has them all). Fix each as below, then run this step
again:

- `The review report could not be read`, or it is for another name or version:
  just run it again.
- `Review issue, <dimension>`, or a dimension with no verdict: fix the issue.
- `<id> is not in spec/acceptance.json`, or `<id> has no test and no manual
  check`: write the test the criterion needs.
- `names a test that is not in any *_test.ts`: the reviewer misnamed it.
- `is not for the content as it is now`: the code changed after the review
  (readiness compares the checkout's content hash with the report's). Review
  again with a new agent; never rename the report.
- `test failed`, `<id>'s test "..." failed`, `did not run`, or `tests could
  not be run`: readiness runs the tests itself; fix the code or the test.
- `Quality gate: ...` or `client points; earn ...`: earn the factors it names,
  as step 8 does.
- `maps <id> more than once`, `more than one verdict`, or a manual check that
  `doesn't say who did it` or `did not pass`: the reviewer fixes the map or report.
- `The visibility check has not run`, or the manifest says public when its
  required checks failed: run step 9 again.
- `each.line is still the draft's`: set it in the recipe's tag, as the app's
  `CLAUDE.md` says, and commit.
- `The recipe does not answer "<phrase>"`: widen the tag's `pattern`, or fix what
  the detail says. Never drop a phrase to pass.
- `No recipe answers the phrases`, or the manifest lacks the file or the
  `puddlerouter-recipe` label: put them back, or, if the draft wrote none, write
  the recipe by hand as the app's `CLAUDE.md` says, or change the spec. Only an
  input of free text means no recipe: then delete the file so `Recipe: none`
  says why.
- `The entry point ... has N steps`, `The recipe took ... s` or `did not
  finish`: point the recipe at one method that does them all, or at one that
  answers from the latest stored result, as the app's `CLAUDE.md` says.
- `The recipe "..." calls the method`: fix the recipe's `methodName`, or put the
  method back.
- `The recipe could not be checked`: swamp or the network failed, not the app.

`true`, with no scope problems in the reply, means go on to step 11. Otherwise
fix each finding the way step 7 does (test first), run step 8's checks, commit
with the message `Fix review findings for NAME`, and, if any file changed, run
step 9's visibility workflow again (ask again only if its answer changed). Then
repeat this step with a **new** agent; never send the fix back to the old one.
If it is still not ready after two rounds, stop and show the user the blockers.

## Step 11: Open the PR

```bash
cd W
make publish VISIBILITY=V DRY_RUN=1
```

Expect `dry run only; nothing was pushed`, after the tests, `deno check`,
`fmt --check`, the quality gate and a dry run with no warnings. A
`declares visibility` error means step 9's change was not committed; an
`adversarial-review` warning means the code changed after the review, so run
step 10 again. Commit the report and the criteria map, push, and open the PR to
the app repo:

```bash
git -C W add swamp-extension-review/ spec/
git -C W commit -q -m "Review NAME for publishing"
git -C W push -u origin draft/NAME
gh pr create --repo ORG/NAME --head draft/NAME --base main \
  --title "Build NAME" --body-file SP/pr.md
```

`SP/pr.md` says what was built, how it was tested (and whether step 7's real
run happened), the visibility and why, and that a fresh agent reviewed it in
how many rounds, then gives the readiness `summary` in a code block, and ends
with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. It names
people by name only, never by email: the summary already hides any address. CI
runs the same dry run, so it is green only with the report committed.

## Step 12: Publish, once the user confirms

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

Then check the request is still at the agreed version: get its outcome spec
again into `SP/outcome-spec.latest.json`, and run step 3's check with
`A=W/spec/app-spec.json`. This is the last point to stop before anything is pushed to the registry. On
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
build result is part of the publish command so it is never forgotten, and its
`buildRef` is the commit that was reviewed and published, not `draft/NAME`,
which can move or go once the PR is merged.

`make publish` never passes `--yes`; the clean dry run is its gate. If it stops,
nothing is recorded: read what it lists, fix it, and repeat from step 10 (the
report must match the new hash). A version that is already published needs a
new `version:` in the manifest, which also means a new review. If the publish
worked but the result did not (`Pass publishedVersion and publishedVisibility
together` means one was left out), run only the `swamp workflow run` command
again, before committing anything in `W`.

## Step 13: Report

Step 12 wrote the build result. If the user stopped before publishing, write
it now with the PR but nothing published, so it still points at the branch:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME \
  --input buildRef=draft/NAME --input pullRequest=PR_URL \
  --input out=SP/NAME.build-result.json --json | jq -r .status
```

The last step is to record the file against the request, in the tool the spec
came from. Factory doesn't call that tool; the builder runs its own method,
which for Capture is the quick start's `### Record a build result`. Give the
user the file's full path (`echo SP/NAME.build-result.json`, with `SP`
absolute), because Capture reads a relative path from its own repo, not this
one. Record the result from step 5 and the one from step 12 the same way.

Capture finds the request from the result's `source.url`, and refuses a result
whose `source.version` and `source.specHash` aren't the agreed version's. A
build from a hand-written app spec has no `source`, so it can't be recorded in
Capture at all: say so to the user, rather than treating it as a failure. If
Capture refuses the version, the request was revised during the build; tell the
user, and don't edit the result to fit.

Recording the published result doesn't release the request. Once published,
the build result carries the recipe from the checkout's tag (`recipe`: its
`id`, the agreed phrases readiness found it answers, and its `empty`), and
Capture checks those against the agreed spec, exactly. Then the request's
outcome owner, not you, installs the published version on their own desk,
sends each agreed phrase through puddlerouter, and records what happened with
Capture's `record_router_test` (the quick start's `### Record a router test`).
Until they do, Capture keeps the request at Building. If the result's log said
it left out the recipe, Capture can't release it either: tell the user why.

Tell the user: the package and version, its visibility and why, the PR (which
they merge), the build result file and whether Capture took it, how long the
run took, and anything skipped (the real run, a check). The build result's
`examples` come from the last readiness check, and each passed one's `detail`
says whether the app ran: say if a recipe's answers were not tried for real,
and if `Recipe: none`, say why. For a request in Capture, say the outcome owner
must test the phrases through puddlerouter and record it before the request is
Released.

## Reusing an existing extension

Follow this instead of steps 3 to 12 when the user said yes to a reuse verdict
in step 2. The `result` workflow needs a draft, so write the build-result/v2 by
hand (`docs/contracts/build-result-v2.md`; issues #41 and #55 track automating it),
with `source` copied from the outcome spec: `url` from `request.url`, `version`
from `specification.version`, `specHash` from `agreement.specHash`.

### `done`: a recipe already answers every phrase

Build nothing. Write a build-result/v2 for the extension that already does it:
`extension` the package the recipe calls, `entryPointRef` the recipe's
workflow, `repository` and `path` that package's repo and the recipe file,
`buildRef` its published commit, `published` its version and visibility, and
`examples` from running `match` and `execute` on each phrase in `DESK`, with
both flags as in step 2, and `recipe` the matched recipe's `id` and `empty` from
its tag with the phrases it answered. If that recipe's `empty` isn't the agreed
`whenEmpty`, exactly, Capture won't release on it: say so, rather than editing
either. Save it
as `SP/NAME.build-result.json` and record it, as step 13 says, as the outcome
owner or a builder on the request. Then tell the user the recipe, the
extension, and links to it on `https://swamp-club.com/extensions/EXTENSION`
and in its git repo.

### A recipe or a scheduled workflow for an existing method

Write one workflow and no model code:

| Verdict                     | Write                                    | Where                               |
| --------------------------- | ---------------------------------------- | ----------------------------------- |
| `recipe-in-our-extension`   | a recipe for `chosen.method`             | `chosen.extension`'s own repo       |
| `recipe-in-pack`            | a recipe for `chosen.method`             | `ORG/recipes-external`              |
| `workflow-in-our-extension` | a scheduled workflow for `chosen.method` | `chosen.extension`'s own repo       |
| `workflow-app`              | a scheduled workflow for `chosen.method` | a new `ORG/NAME` that holds only it |

For `recipe-in-pack`, check the pack exists with
`gh repo view ORG/recipes-external --json visibility -q .visibility`. On
`Could not resolve to a Repository`, this is the first external recipe: make
the pack the way step 4 makes an app repo (ask first, then `gh repo create`
from `$TEMPLATE` with the secrets), but **public**, unlike an app: pass
`--public` in place of `--private`. Remove the template's placeholders, and give
it a `manifest.yaml` named `$COLLECTIVE/recipes-external` with
`visibility: public` (and the same in `ci.yml`), the `puddlerouter-recipe`
label, a README with an empty recipe table, and only `workflows:` (no models).
Step 9's visibility check still runs on it, and a failed required check still
stops it going public.

A recipe is a workflow with one `model_method` step and a `puddlerouterRecipe`
tag, like `workflows/workflow-github-open-prs.yaml` in the `puddlerecipes`
repo's `packs/github/`. On a branch of that repo: add it under `workflows/`,
list it in `manifest.yaml`, add the `puddlerouter-recipe` label if it is
missing, and add a row to the README's recipe table. Run its `make test`,
`make contracts-check` and `make guardrails-check`, run the workflow by hand
against a model definition of the extension, and for a recipe run
`@puddleworks/recipes` `match` and `execute` in `DESK` with each phrase in the
spec. An extension outside `@swamp/*`, `@mesgme/*`, `@webframp/*` and
`@puddleworks/*` also needs an `allow:` entry in the user's
`puddlerouter.yaml`: say so, and don't edit it. Then do steps 10 to 13 against
that repo, asking before creating a repo, opening the PR and publishing. Write
the build-result/v2 by hand: `extension` is the package the workflow went into,
`entryPointRef` the workflow, `path` its file, `repository` and `pullRequest`
that repo's, and `source` as above.

## Revising an app that is already built

For a newer version of a request that already has an app (see Input), don't
draft a new skeleton, which would replace the finished code: change the app on
a branch, from a change plan. Make the branch from the app's `main`, as step 4 does, but name it
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

Commit what it wrote untouched, so the diff shows it:

```bash
git -C W add spec/
git -C W commit -q -m "Take NAME to spec version N"
```

Show the user the plan. If it changes inputs, settings, output or delivery,
agree them with the user and write them into `W/spec/app-spec.json`, as step 3
does. Then do step 6 with the plan as its starting point, and steps 7 to 13,
changing the finished code only where the plan says. Update the app's section
of `W/CLAUDE.md` and `W/README.md`, and give the manifest a new `version:`.
Wherever a step says `draft/NAME`, use the revision branch. The build result
names version `N` and its hash, which is what Capture checks.

### Proposing a revision from the build side

If building shows the agreed spec has to change, propose the change in Capture
rather than building past it: edit `W/spec/outcome-spec.vN.json` (the highest
version) and propose it with the quick start's `### Propose a revision`, giving
that file's **absolute** path and a one-sentence reason. Capture proposes it to
the outcome owner as version `N+1`; once they agree and it is exported, revise
the app from that export as above.
