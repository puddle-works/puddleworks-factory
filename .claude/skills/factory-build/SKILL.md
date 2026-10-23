---
name: factory-build
description: >
  Build the first draft of a swamp app from an agreed outcome spec
  (puddleworks.dev/outcome-spec/v1) or a puddleworks.dev/app-spec/v1 spec (a
  file path, an https URL or inline JSON): for an outcome spec, prefill an app
  spec and agree the builder's decisions with the user; generate the skeleton
  (extension, tests, workflow) on a branch in an app repo, with both specs kept
  beside it; then write a build plan for filling it in. Does not implement or
  open a PR. Triggers on: "factory build", "build from spec", "build this
  puddle", "plan the build for <spec>", "/factory-build <spec>".
---

# Factory Build

Turn an app spec into a skeleton on a branch in an app repo and a build plan
for filling it in. **This skill writes the plan and stops.** It does not write
behaviour code or open a PR.

1. **Generated skeleton**: the `@puddleworks/puddleworks-factory-build` workflow
   checks the spec against the contract and writes the files. The skeleton
   always compiles and passes its own tests. It is committed and pushed on
   `draft/NAME`.
2. **Build plan**: you write a plan against the skeleton and save it, to paste
   into an agent.

Factory reads only the spec. Whoever wrote the spec (a person, another tool)
has already agreed it; Factory does not check approvals.

## Input

The spec: a file path, an `https://` URL, or the JSON itself. Ask for it if the
user did not give one.

The app repo: `APP`, the absolute path of a git checkout of the repo the app
goes in, with an `extensions/models/` directory. Ask for it if the user did not
give one.

Check which kind of spec it is:

```bash
jq -r '.format // .apiVersion' SPEC_FILE   # or: curl -fsSL SPEC_URL | jq -r '.format // .apiVersion'
```

- `puddleworks.dev/outcome-spec/v1`: an agreed request
  (`docs/contracts/outcome-spec.md`). It says what success looks like, not how
  to build it. Do step 1, then **step 1a** to turn it into an app spec.
- `puddleworks.dev/app-spec/v1`: already an app spec
  (`docs/contracts/app-spec.md`). Its `name` is the app name. Skip step 1a.

Below, `NAME` is the app name, `SPEC` is the app spec to build from, and `W` is
`APP-draft-NAME`, a worktree beside `APP`. The contracts are in `docs/contracts/`
in the puddleworks-factory repo.

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

Skip this for an app spec. Let `SP` be the scratchpad directory and `OUTCOME`
the absolute path of the outcome spec file. If the user gave a URL or pasted
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
mkdir -p W/puddles/NAME/spec
cp OUTCOME W/puddles/NAME/spec/outcome-spec.v$(jq -r .specification.version OUTCOME).json
cp SP/app-spec.json W/puddles/NAME/spec/app-spec.json
```

In step 3, `SPEC` is `W/puddles/NAME/spec/app-spec.json`.
The build checks it fully: a field left blank fails there with
`is not a valid puddleworks.dev/app-spec/v1 spec`.

## Step 2: Make a branch in the app repo

```bash
git -C APP fetch origin --quiet
git -C APP worktree add W -b draft/NAME origin/main
```

Expect `HEAD is now at …`. If the branch already exists, this is a re-draft:
reuse the existing worktree instead and pass `overwrite=true` in step 3 only if
the user agrees to replace the files. This is a plain git worktree: do not link
it to any other worktree.

## Step 3: Generate the skeleton

```bash
swamp workflow run @puddleworks/puddleworks-factory-build --input spec=SPEC --input targetDir=W --json \
  | jq -r '.status + " " + ([.jobs[].steps[] | select(.status=="failed") | .error] | join(" | "))'
```

For inline JSON, quote it: `--input "spec=$(cat spec.json)"`. The draft is
public under `@puddleworks/NAME` by default. To keep it off the public registry,
add `--input visibility=private`.

`succeeded` means the files are written. On `failed`, tell the user what the
message says in plain words and stop:

| Message contains                                        | Meaning                                        | What unblocks it                                        |
| ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `is not a valid puddleworks.dev/app-spec/v1 spec`       | The spec breaks the contract; each rule listed | Fix the spec where it was written                       |
| `is not JSON or YAML`                                   | The spec text does not parse                   | Fix the file, or quote the inline JSON                  |
| `Could not read` / `returned 404` / `only fetched over` | The spec could not be read                     | Check the path or URL; URLs must be `https://`          |
| `has no swamp workflow to draft`                        | Delivery is `external_app` or `manual_process` | Nothing to draft; this skill does not apply             |
| `Refusing to overwrite files that already exist`        | A draft is already on this branch              | Re-run with `--input overwrite=true` if the user agrees |
| `does not look like an app repo checkout`               | `targetDir` has no `extensions/models/`        | Point it at the app repo worktree from step 2           |

Then commit the skeleton untouched (with `puddles/NAME/spec/` when it came from
an outcome spec), so review can tell generated code from written code:

```bash
git -C W add -A
git -C W commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "draft: generated skeleton for NAME" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C W push -u origin draft/NAME
```

Then write the build result (`puddleworks.dev/build-result/v1`, see
`docs/contracts/build-result.md` in the puddleworks-factory repo), so whoever
handed over the spec can see where the build went. `REPO` is the app repo's
https URL (from `git -C APP remote get-url origin`), e.g.
`https://github.com/example/my-apps`:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result --input name=NAME --input repository=REPO \
  --input buildRef=draft/NAME --input out=<scratchpad>/NAME.build-result.json --json | jq -r .status
```

Expect `succeeded`. `No draft of "NAME" has been rendered` means the generate
step above did not run on this swamp repo's `puddleworks-factory` model.

## Step 4: Write the plan

Read `W/puddles/NAME/CLAUDE.md` (purpose, inputs, settings, output, out of
scope), the spec, and the skeleton under `W/extensions/models/` and
`W/puddles/NAME/`. If it came from an outcome spec, also read
`W/puddles/NAME/spec/outcome-spec.v*.json`: its acceptance criteria are what
"done" means, so turn each one into a test or a verification step, and its
constraints and assumptions are scope lines. Then write a plan, as markdown,
with these sections:

- **Context**, and the branch to start from (`draft/NAME`).
- **What to build**, within the spec: the behaviour that replaces the `run`
  stub, and the shape of `ResultSchema.items`.
- **Files to change, and tests to write first.** Tests of the behaviour call
  `run` directly with working settings (a temp directory, a fake server). The
  generated tests and their `SETTINGS` placeholders stay untouched.
- **Scope lines**: do not rename, add or remove inputs or settings; do not add
  anything on the out-of-scope list, new permissions, or secrets the settings do
  not name; if the behaviour cannot be built within these limits, stop and
  report that the spec needs changing. Search before building.
- **Register the app**: in `W/Makefile` add
  `$(DENO) test <flags> extensions/models/<name_with_underscores>_test.ts` to
  the `test` target; in `W/CLAUDE.md` add a row to the **Puddles** table and the
  same command to **Development**; give the "Test it" command in
  `W/puddles/NAME/README.md` the same flags.
- **Checks**: `swamp extension fmt puddles/NAME/manifest.yaml` (the draft is not
  formatted as generated), `deno check` and `deno test` on the extension and its
  test file, and `swamp workflow validate <entryPointRef>` (the full
  `@<collective>/<slug>` name; the `model not found` warning is expected in a
  fresh worktree).
- **Commit and draft PR**: commit with
  `--author="Claude Code <claude-code@anthropic.com>"`, push `draft/NAME`, open
  a draft PR to the app repo, never merge. Then run
  `@puddleworks/puddleworks-factory-result` again as in step 3, adding
  `--input pullRequest=<PR URL>`, so the build result links the PR.
- **Verification**, including a real end-to-end run of the workflow.

Save it to the scratchpad as `plan.md` and copy it to
`~/.claude/plans/NAME.md`.

## Step 5: Stop and report

Tell the user the branch (`draft/NAME`), the plan file path
(`~/.claude/plans/NAME.md`) and the build result file. Do not implement
anything or open a PR. The build result file is the record of the build. If
the spec had a `source`, the build result names the request, version and hash,
so it can be matched to the request later.
