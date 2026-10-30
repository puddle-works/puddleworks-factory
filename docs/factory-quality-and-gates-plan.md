# Factory quality, tracking and gates: implementation plan

## Goal and boundaries

Take an agreed specification to a Swamp extension that satisfies the current requirements for an A-grade registry review, with evidence for each step and explicit human decisions where needed. A build must stay within its approved target repository and scope, resume safely, and stop when a gate is not satisfied. An A cannot be guaranteed in advance: rubric changes, registry-only checks and the quality of the completed implementation remain relevant. The factory should report what it has proved and what remains unknown.

This is a plan, not an implementation. The issues below are the implementation backlog. The existing [ADR-001](adr/ADR-001-three-separate-apps.md) keeps Factory independent of Capture and Distribution through versioned file contracts.

## Current evidence

- `workflows/workflow-build.yaml` runs only `render`; `.claude/skills/factory-build/SKILL.md` instructs an agent through implementation, checks, review and publishing. Those instructions alone do not enforce stage order or constrain all writes.
- `extensions/models/draft.ts` checks for `.swamp.yaml` in `targetDir` and protects existing files unless overwrite is requested, but does not establish that the target is the intended app rather than the Factory checkout.
- `extensions/lib/readiness.ts` checks report name and version, date, supplied dimension verdicts, visibility and criterion mappings. It does not itself prove the expected complete set of review dimensions, current artifact hash, reviewer independence or that named tests actually passed. Where there is no outcome spec, it returns no criteria; an app-spec-only path needs explicit acceptance policy.
- The skill already requests tests, contract and guardrail checks, workflow validation, a local quality score of 100%, an independent review and confirmation before publication. `.github/workflows/ci.yml` runs formatting, tests and `swamp extension quality`, but does not explicitly assert a numeric threshold.
- On 2026-10-30, `swamp extension quality manifest.yaml --json` reported **87%**, no gate failures, and the verified public repository factor as provisional. This is a local observation of Factory itself, not a registry grade or a score for generated extensions. The installed CLI describes ten client-earnable factors and also reports the provisional registry factor. Establish grade calculation and registry behavior before setting a numeric rule.
- The registry has two official stage-and-gate engines, both in `swamp-club/swamp-extensions` and both AGPL-3.0-or-later:
  - `@swamp/stagecraft` (2026.10.26.2) is the newer one. Its `DESIGN.md` ports software-factory's examples and records software-factory defects it was built to avoid: cross-work-item reads through record-name prefixes (#2526), only the latest override grant counted (#1487, #2175), and `${{ }}` interpolation failing silently. It lists building swamp extensions, with `swamp extension quality` as a gate, among its uses and ships a `build-swamp-extension.yaml` example (plan, plan-review, implement, check, code-review, release).
  - `@swamp/software-factory` (2026.10.23.1) is the older generic engine. It is still maintained, but Stagecraft supersedes it for new work.
  - Stagecraft states that locally "the agent and the person run as the same principal, so an approval cannot show which of them gave it". No local engine can prove that a person, not the agent, approved an action.
- `@atalanta/external-reviewer` (2026.07.11.1) is an external independent-review integration. Local type search found no review type. It is a candidate to inspect in #49, not a proven integration.

## Engine decision

Factory will not build on `@swamp/software-factory`. It will not adopt Stagecraft as a runtime dependency now either. Instead, Factory applies the principles below in its own methods: each method that writes, opens a PR or publishes checks its own preconditions and fails closed. Most of the backlog (#48, #49, most of #50) is about `draft.ts` and `readiness.ts`, whatever enforces stage order. Adopting an engine would make it the owner of the process and the Factory a set of stage work inside someone else's definition. That cuts against ADR-001's independence and adds a dependency on a fast-moving extension.

Revisit this in #47. Write the Factory lifecycle as a Stagecraft definition, starting from `build-swamp-extension.yaml`, and record how well it fits. Adopt Stagecraft instead of building our own if the design turns out to need a stored stage graph with transitions, bounded loops, a journal and content-bound approvals: that would rebuild Stagecraft. Adopting it would also cover much of #46, because the Stagecraft studio Board shows work items, but only Stagecraft records.

Using Stagecraft means writing a factory definition as data against its published types. Applying its principles means reimplementing them in Factory's MIT code; do not copy AGPL source into Factory.

### Principles to adopt

| Principle | Source | Applies to |
| --- | --- | --- |
| Each method with a side effect re-evaluates its own gates when it runs. A status or readiness view never reports ready for something the action would refuse. | Stagecraft gates, software-factory `advance` | #50, #51 |
| An approval records the SHA-256 digest of the canonical JSON of each item it approves. A changed item voids the approval; a newly added item does not. | Stagecraft approvals | #51 |
| Every write carries the state it expects (stage, cycle, artifact version) and is refused on a mismatch, so a writer acting on a stale view fails. | Stagecraft run record | #47, resumption |
| Write payloads first and the record that references them last. A crash leaves an unreferenced payload, never a half-applied change. | Stagecraft run record | #47, resumption |
| A check passes only when swamp's own run records show it succeeded, never on the driver's word. | software-factory `workflow-succeeded` | #50 |
| A rejected payload is kept and returned as retry feedback rather than thrown away. | Stagecraft, software-factory validation records | #50 |
| Every loop is bounded: a cycle limit per stage and a dispatch cap per entry. Going past one needs an override, recorded with who granted it. | Stagecraft circuit breakers | #47, #51 |
| Every event records its actor: the platform principal, with any claimed identity kept beside it, never in its place. | Stagecraft actors | #51, tracking |
| Work-item identity comes from the record it belongs to, not from a prefix in record names. | Stagecraft (software-factory #2526) | #47, evidence storage |
| Saved scenarios are re-checked against the stage graph whenever it changes. | Stagecraft scenarios | #52 |

## Proposed delivery order

1. **Decide stage enforcement and define the lifecycle — [#47](https://github.com/puddle-works/puddleworks-factory/issues/47).** Run the Stagecraft fit check and record the decision against the threshold above. Define work-item identity, stages, transition conditions, loop bounds, evidence schema, retry semantics and migration of existing drafts. Use [#41](https://github.com/puddle-works/puddleworks-factory/issues/41) for discovery and reuse before creating a repository; accommodate [#28](https://github.com/puddle-works/puddleworks-factory/issues/28) for revised specs rather than overwriting completed work. Preserve the current standalone Factory workflows where compatible and document migration where not.
2. **Protect the build target — [#48](https://github.com/puddle-works/puddleworks-factory/issues/48).** Bind each run to an approved repository, canonical checkout and branch; reject the Factory checkout, wrong remotes, traversal and symlink escapes before writing. Name the runtime control that confines the builder (for example Claude Code permission rules limiting writes to the approved checkout) and state the limits of anything that cannot be confined. Account for the existing-extension recipe path in #41 and revised-app path in #28. Factory maintenance requires a separately authorized target.
3. **Establish the actual A-grade requirements — [#49](https://github.com/puddle-works/puddleworks-factory/issues/49).** Verify current registry grade, rubric, publish dry-run and review formats against the installed CLI and authoritative documentation. Distinguish locally provable factors, provisional factors and post-publication verification. Measure a representative completed output, improve templates and checks, and record actionable findings with file and evidence references. Search existing tools and evaluate the independent-review integration before deciding whether a separate reusable review/report extension is justified; file a separate follow-up only if the investigation demonstrates a gap.
4. **Make evidence authoritative — [#50](https://github.com/puddle-works/puddleworks-factory/issues/50).** Bind checks, complete review dimensions, reviewer provenance, spec version and acceptance outcomes to the current artifact digest and tool/rubric versions. Take check results from swamp's run records; a test name or description of a manual check is not a successful result. Fail closed on missing, failed, incomplete or stale evidence, and keep rejected evidence as retry feedback. Define how app-spec-only builds demonstrate acceptance. Recheck the exact artifact inside the method that takes the external action.
5. **Enforce human decisions — [#51](https://github.com/puddle-works/puddleworks-factory/issues/51).** Record each decision as a durable record scoped to the action and bound to the digests of what was approved, with its actor. Revalidate inside the side-effecting method. A change to the target, content or visibility invalidates affected approvals. A prompt or timeout does not count as approval. Locally the agent and the person share one principal, so state plainly that Factory cannot prove who gave a local approval; the skill must still never approve its own work. Explicitly authorized session decisions should not be requested again unnecessarily.
6. **Prove the whole path — [#52](https://github.com/puddle-works/puddleworks-factory/issues/52).** Exercise the lifecycle in CI using a disposable app checkout and fake external services, including resumption, loop limits and adversarial attempts. Run a real sandboxed dry run where available. Verify the registry grade only after an authorized publication. Coordinate with [#19](https://github.com/puddle-works/puddleworks-factory/issues/19) for empty run results, [#36](https://github.com/puddle-works/puddleworks-factory/issues/36) for logging, [#45](https://github.com/puddle-works/puddleworks-factory/issues/45) for example results and [#46](https://github.com/puddle-works/puddleworks-factory/issues/46) for a possible read-only status view.

Steps 2 and 3 do not depend on the engine decision and can start now, alongside step 1. Steps 4 and 5 depend on the lifecycle and evidence design. Step 6 validates their integration. [#37](https://github.com/puddle-works/puddleworks-factory/issues/37) covers configurable GitHub organization and template settings and should inform target and approval design.

## Lifecycle and gates

| Stage | Required evidence or decision before advancing |
| --- | --- |
| Intake and reuse | Valid spec and identity; search existing extensions and record fit; obtain the user's choice if a suitable reuse path is offered. |
| Agree and select target | Resolved material specification choices; approved app repository, checkout and branch; human approval before creating an external repository. |
| Generate and implement | Draft and implementation within approved target and scope; dispatch and artifacts recorded; acceptance criteria and tests planned. |
| Validate | Successful format, tests, contracts, guardrails, workflow validation, isolated quality checks and publish dry run, as applicable; record exact versions, results, run IDs and artifact digest. Missing checks block advancement. |
| Decide visibility | Present recommendation and findings; record the user's choice. Obtain applicable approval before making an external repository public. Visibility changes invalidate affected quality and review evidence. |
| Independent review | A reviewer independent of the builder assesses the current artifact and spec, records all required dimensions and acceptance outcomes, and resolves findings. Verify provenance to the extent the runtime supports it; report any limitation. |
| PR and publication | Record PR and human review status separately from permission to publish. Present a concrete publication summary and obtain approval bound to the exact artifact digest, version, destination and visibility. Never merge a PR without explicit authorization. |
| Record | Persist the final build result, PR, publication outcome, artifact identity and remaining limitations; include example results through #45 when available. |

The exact stage graph and enforcement mechanism follow the decision in #47; do not assume that a workflow DAG alone enforces every external action. Every transition and every side-effecting method checks current evidence, including when resuming a run. Each loop back (for example review findings returning work to implementation) has a cycle limit; going past it needs a recorded override. Failures remain visible, do not silently advance, and preserve diagnostics. A material change routes the work back to the relevant checks and review. The system must not claim that it can enforce restrictions outside the tools or execution environment it controls.

## Tracking and verification

Each work item should expose its current stage, blockers, target, spec and content identifiers, evidence and approval history with actors, run IDs, PR and publication status. Store versioned evidence and decisions in Swamp data, and use a report for repeatable summaries rather than scraping logs. Do not put secrets or spec contents in diagnostic logs. The existing `build-result/v1` remains the external handoff; add fields compatibly or version the contract if the investigation requires more than existing fields.

The integration suite must demonstrate both the happy path and blocked paths: wrong or symlinked target, attempts to write into Factory, skipped stages, failed or absent checks, checks claimed without a run record, incomplete or stale review, failed acceptance tests, denied or missing approval, changes after approval, stale writes, loops past their limit, and interrupted/resumed execution. Assert no external side effect for a blocked operation. Confirm a representative finished extension passes all locally verifiable A requirements, and separately record the registry's actual result once an authorized release exists.

For the architecture, the Swamp architecture guide points to `design/primitives/workflows.md` for DAG orchestration, `design/primitives/behaviors.md` for resource methods, and `design/enablers/reports.md` for repeatable analysis. Keep gates in the behavior methods that take each action, use workflows to compose those methods, and use reports to analyze recorded evidence.
