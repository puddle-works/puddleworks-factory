# ADR-002: Stagecraft runs the Factory's stages

## Status: Accepted

Decided by Mark Ellens on 2026-11-09, for
[#47](https://github.com/puddle-works/puddleworks-factory/issues/47). This
replaces the default in
[factory-quality-and-gates-plan.md](../factory-quality-and-gates-plan.md),
"Engine decision", which was to build Factory-native gates.

Amended by Mark Ellens on 2026-11-12: the definition is now a copy of
Stagecraft's own example with Factory's stages added. See
[Amendment: built on Stagecraft's example](#amendment-built-on-stagecrafts-example).

## Context

The build workflow only renders a draft. The order of stages, the rework loops
and the approvals live in the factory-build skill's prose, so a driving agent
can skip a stage, and nothing counts the rounds of review. The plan said to
adopt `@swamp/stagecraft` if the design turned out to need a stored stage graph
with transitions, bounded loops, a journal and approvals bound to what was
approved. #47's own acceptance criteria ask for all four, plus refusing writes
made from an out-of-date view. Building them in Factory would rebuild
Stagecraft.

The worry was overhead, especially too much adversarial review. Stagecraft runs
only the stages and gates a definition declares, so that is a choice in the
definition, not in the engine.

## Decision

- `@swamp/stagecraft` owns stage order, loop limits, the journal and approvals.
  The Factory lifecycle is a Stagecraft factory definition,
  [docs/stagecraft/factory-build.yaml](../stagecraft/factory-build.yaml).
- The definition was lean: one independent review stage and no plan review,
  allowing three reviews in all before a person must grant another. A person
  decided at the same points as the skill: acting on the reuse assessment, the
  spec, creating a repo, visibility and publishing. The amendment below replaces
  this with Stagecraft's example and two reviews.
- Intake takes its exits from the assess verdicts of #41 and #55: `build` for
  `build-functionality` or a declined reuse, `reuse` for a recipe or scheduled
  workflow on an existing method (no draft is generated), and `already-done`
  when an existing recipe answers every phrasing (nothing is built).
- Factory's own methods keep the checks Stagecraft cannot make, and fail closed
  inside the method that acts:
  - confining writes to the approved app checkout (#48);
  - binding readiness to complete, current evidence taken from swamp's run
    records (#50). Stagecraft records what the driver reports, such as a
    workflow's `runId`, without checking it.
- The definition is data written against Stagecraft's published types. No
  Stagecraft source is copied into Factory, which stays MIT; the Swamp extension
  exception covers definitions. ADR-001's file contracts are unchanged.

## Fit check

Stagecraft's own `validate` method (schema, graph analysis and saved scenarios)
passes the definition with 0 warnings and 6 of 6 saved scenarios. It was run
through Stagecraft's fake swamp from `swamp-club/swamp-extensions` at
`fac5d641b46ffb1247e909d44da9a0174ef9ff15` (`@swamp/stagecraft` 2026.11.05.3);
later runs, below, used the swamp CLI. The scenarios show that:

- the spec, repo-creation and publish approvals each block until given;
- the fourth review is refused until a person grants an override;
- a commit that was already checked cannot be submitted again;
- the visibility choice carries over through rework;
- after rework, an earlier publish approval no longer counts, and checks and
  review run again on the new commit;
- a PR for an older commit, or a release with another visibility, is refused;
- an `already-done` verdict builds nothing and needs the person's yes;
- a new external recipes pack must be created public, and skips the draft.

What needed working around:

- Only the stage that declares a product can record it, so changing the commit
  after the PR goes back to implement by a manual `rework`.
- Evidence counts only in the pass it was recorded in, so the visibility stage
  reads the person's choice with a CEL gate to carry it over.
- `target` and `repo-created` carry a `route` (`build` or `reuse`), and a CEL
  gate checks it against intake's decision. Without it, Stagecraft cannot prove
  the build and reuse exits exclusive.

## Approvals (#51)

Stagecraft records each decision with its principal, time and a digest of every
product recorded before it; a changed product voids it, a decline blocks until
the person approves again, and none carries over to a later pass. The definition
adds what that does not cover:

- `reuse` and `already-done` need `reuse-approval`. The person's recorded
  `reuse-choice` alone is the agent's record, not their decision.
- The person approves a `publish-request` naming the commit, version,
  visibility, PR and spec digest, each checked against the reviewed commit, the
  visibility choice and the approved spec. Visibility is approved there, with
  the publish, so it is asked once.
- Right before anything is pushed, `publish` records a `publish-check`
  (readiness, the PR head, the spec version). `released` refuses a check of
  another commit, a moved PR or a release unlike the request; a failed check
  goes back to `pr` by a manual `stopped`, where the approval must be given
  again.
- `generate` passes the approved spec digest to `render`, which refuses a spec
  file changed since. This one runs inside Factory, where Stagecraft cannot see.
- The only review exception is a cycle override, which Stagecraft records as a
  person's grant. Publishing approval is never approval to merge.

Saved scenarios `approvals-voided-and-declined` and `publish-approval-guarded`
exercise a changed spec, target and publish request, declines, a missing check
and a moved PR. The definition passes `validate` under the swamp CLI with
`@swamp/stagecraft` 2026.11.05.3: 0 warnings, 8 of 8 scenarios. `publish-check`
is recorded by the driving agent, so it is evidence of the check, not proof; the
external commands themselves (`gh repo create`, `gh repo edit`, `make publish`)
are run by the agent and are not gated inside Factory.

## Amendment: built on Stagecraft's example

Decided by Mark Ellens on 2026-11-12. Stagecraft ships
`build-swamp-extension.yaml` (plan, plan-review, implement, check, code-review,
release), its own process. A definition cannot extend another, so
`factory-build.yaml` is now a copy of that example from `@swamp/stagecraft`
2026.11.11.1, with Factory's stages added and the example's stages kept as
written. A diff against the example shows only these changes to its stages:

- `plan` is no longer the initial stage; Factory's `intake` is.
- `check`'s two passed exits go to Factory's `visibility`, not `code-review`.
- `code-review` allows two reviews (`maxCycles: 2`). Its prompt adds the round
  number, the app checkout, the spec and the report path; round 1 reviews the
  whole repo and round 2 only `git diff` from round 1's commit. It also injects
  `spec` and `round`. `accept` goes to Factory's `pr`.
- `release`'s `released` goes to Factory's `record`.

Factory adds `intake`, `record-existing`, `target`, `create-repo` and `generate`
before `plan`, and `visibility`, `round`, `pr`, `pre-publish`, `record` and
`reused` after `check`. So the example's plan review with `plan-approval`, its
quality waiver, its `release-approval` and its `duplicate` exit are now part of
every build; Factory's `publish-approval` still binds the head, version,
visibility, PR and spec digest.

Factory's round workflow (`@puddleworks/puddleworks-factory-round`, the
`review-rounds-NAME` record) keeps the review count: two per build until a
publish, across versions, with a review carried over when only the version
changed. `code-review`'s `maxCycles` mirrors it, the `round` stage's `carried`
exit skips `code-review` for a carried or committed review, and a third review
needs the person's yes as both a cycle override for `code-review` and
`grant=true` to the round workflow. Factory's record wins when the two disagree,
as after a `reset`.

Fixes to the earlier definition:

- `generate` passes `branch`, so render checks the checkout is on `draft/NAME`.
- `visibility` runs the visibility workflow on every pass and asks again only
  when its recommendation changed; a manifest that does not say the chosen
  visibility goes back to implement.
- Readiness that is not ready on the PR's head goes back to implement without a
  person (`not-ready`), and a failed check right before publishing goes back to
  `pr` on its own (`stopped`), where the person approves again.
- `record-existing` records a build-result/v2.

`validate` under the swamp CLI with `@swamp/stagecraft` 2026.11.11.1: 20 stages,
1 warning (the example's own plan loop is bounded only by the default cycle
limit) and 12 of 12 saved scenarios. Four of the earlier scenarios carry over;
the others are replaced by ones that walk the example's stages.

## Consequences

- Users pull `@swamp/stagecraft` alongside Factory, and the factory-build skill
  becomes a Stagecraft driver. That rewrite waits for the other skill changes in
  flight, to avoid conflicts.
- The happy path is about 45 agent CLI calls (dispatch, record, advance per
  stage), none of which need a person. The amendment's plan, plan-review and
  round stages add about 10 more, and two person stops (`plan-approval` and
  `release-approval`).
- Factory depends on an extension that changes fast. Its definition format is at
  schemaVersion 5; Stagecraft upgrades older definitions on read.
- Locally the agent and the person run as one principal, so no approval can show
  which of them gave it. This holds for any local engine. Separate tokens under
  `swamp serve` could show it, and are untested.
- Still to do for #47: run the definition under the swamp CLI, the integration
  tests for retries, interruption and concurrency, and migrating existing
  drafts. #52 proves the whole path.
