---
name: factory-build
description: >
  Build the first draft of a swamp app from a puddleworks.dev/app-spec/v1 spec
  (a file path, an https URL or inline JSON, from Capture or anywhere else):
  generate the skeleton (extension, tests, workflow) on a branch in an app repo,
  then write a build plan for filling it in. Does not implement or open a PR.
  Triggers on: "factory build", "build from spec", "plan the build for <spec>",
  "/factory-build <spec>".
---

# Factory Build

Turn an app spec into a skeleton on a branch in an app repo (normally
`puddle-works/puddleworks-apps`, checked out at `~/dev/puddleworks-apps`) and a
build plan for filling it in. **This skill writes the plan and stops.** It does
not write behaviour code, open a PR or start racers.

1. **Generated skeleton**: the `@mesgme/puddleworks-factory-build` workflow
   checks the spec against the contract and writes the files. The skeleton
   always compiles and passes its own tests. It is committed and pushed on
   `draft/NAME`.
2. **Build plan**: you write a plan against the skeleton and save it, to paste
   into an agent or hand to `/race`.

Factory reads only the spec. Whoever wrote the spec (Capture, a person, another
tool) has already agreed it; Factory does not check approvals.

## Input

The spec: a file path, an `https://` URL, or the JSON itself. Ask for it if the
user did not give one. The spec's `name` is the app name. Read it first:

```bash
jq -r .name SPEC_FILE        # or: curl -fsSL SPEC_URL | jq -r .name
```

Below, `NAME` is that name, `SPEC` is what the user gave, and `W` is
`$HOME/dev/puddleworks-apps-draft-NAME`. The contract is in
`docs/contracts/app-spec.md` in the puddleworks-factory repo.

## Step 1: Make sure the factory model exists

Run swamp from the swamp repo where `@mesgme/puddleworks-factory` is installed.
Check for the model instance:

```bash
swamp model get puddleworks-factory --json 2>&1 | jq -r '.type // .error'
```

`@mesgme/puddleworks-factory/draft` means it exists.
`Model not found: puddleworks-factory` means create it once:

```bash
swamp model create @mesgme/puddleworks-factory/draft puddleworks-factory --json | jq -r .type
```

## Step 2: Make a branch in the app repo

```bash
git -C ~/dev/puddleworks-apps fetch origin --quiet
git -C ~/dev/puddleworks-apps worktree add ../puddleworks-apps-draft-NAME -b draft/NAME origin/main
```

Expect `HEAD is now at …`. If the branch already exists, this is a re-draft:
reuse the existing worktree instead and pass `overwrite=true` in step 3 only if
the user agrees to replace the files. This is a plain git worktree: do not link
it to any other worktree.

## Step 3: Generate the skeleton

```bash
swamp workflow run @mesgme/puddleworks-factory-build --input spec=SPEC --input targetDir=$HOME/dev/puddleworks-apps-draft-NAME --json \
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

Then commit the skeleton untouched, so review can tell generated code from
written code:

```bash
git -C $HOME/dev/puddleworks-apps-draft-NAME add -A
git -C $HOME/dev/puddleworks-apps-draft-NAME commit -q --author="Claude Code <claude-code@anthropic.com>" \
  -m "draft: generated skeleton for NAME" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C $HOME/dev/puddleworks-apps-draft-NAME push -u origin draft/NAME
```

## Step 4: Write the plan

Read `W/puddles/NAME/CLAUDE.md` (purpose, inputs, settings, output, out of
scope), the spec, and the skeleton under `W/extensions/models/` and
`W/puddles/NAME/`. Then write a plan in the shape of
`~/.claude/plans/opencode-race.md`, as markdown, with these sections:

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
  a draft PR to the app repo, never merge.
- **Verification**, including a real end-to-end run of the workflow.

Save it to the scratchpad as `plan.md` and copy it to `~/.claude/plans/NAME.md`
so a bare `/race` picks it up.

## Step 5: Stop and report

Tell the user the branch (`draft/NAME`) and the plan file path
(`~/.claude/plans/NAME.md`). Do not implement anything, open a PR, or start
racers. If the spec came from Capture, recording the build on the request is
Capture's job, not this skill's.
