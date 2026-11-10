# What an A needs, and what the Factory can prove before publishing

Findings for
[#49](https://github.com/puddle-works/puddleworks-factory/issues/49), checked on
2026-11-09 with swamp `20261109.082430.0-sha.07a55dd5`, rubric version 6,
against the
[Scorecard Rubric](https://swamp-club.com/manual/reference/extensions/scorecard-rubric).

## The grade

- The rubric has 12 factors worth 16 points. The grade comes from the percentage
  of 16, rounded down: A from 90%, B from 75%, C from 60%, D from 40%.
- `swamp extension quality` and the registry score with the same package,
  `@swamp-club/extension-scoring`, so the CLI gives the same rows as the
  registry.
- 14 points can be proved before publishing. The other 2 are
  `repository-verified`, which only the registry decides: it asks GitHub's API
  whether the `repository` URL is a public repo. Locally the factor shows as
  `provisional`, so the best local result is **14/16, 87%, grade B**, with
  `ifProvisionalEarned` showing 100% (A).
- So an A needs every client factor earned **and** a public repo the registry
  verifies. A **private app in a private repo gets B at best**, unless Swamp
  Club marks the collective for private source hosting. The factor then reads
  "Private repository (collective attested)".
- `--isolated` scores `deno doc` the way the registry does (an empty cache and
  no tokens). A draft scored the same both ways.

## What the Factory now checks

- A freshly rendered draft used to fail the `fmt-lint` gate, because the
  generated TypeScript was not laid out as `deno fmt` lays it out. `render` now
  writes it that way, and the draft acceptance tests run `deno fmt --check`. A
  fresh draft of the example spec, private or public, now scores 14/14 client
  points with no gate failures, in normal and `--isolated` mode.
- Factory's own CI fails unless every client factor is earned and no gate
  failed:

  ```bash
  swamp extension quality manifest.yaml --json > quality.json
  jq -e '(.gateFailures | length) == 0 and .earnedPoints == .maxClientEarnablePoints' quality.json
  ```

## Gaps

- An app's CI and `make publish` run `scripts/publish.sh` from
  `puddle-works/puddle-tooling`. From `v0.2.3` it also stops unless every client
  factor is earned, and new drafts pin `v0.2.3`. Apps drafted earlier keep their
  own `tooling-ref` until it is bumped.
- Since #50, readiness runs `swamp extension quality` itself and ties the review
  report to the content hash it reports.
- The registry's actual grade is known only after an authorized publish. Read it
  from the extension page, or from `GET /api/v1/extensions/:name/score`.

## Review extensions

`@atalanta/external-reviewer` is the only reviewer in the registry (searched
`reviewer` and `review`). It bridges `@mgreten/cli-agent` into
`@swamp/software-factory`, which ADR-002 ruled out. Under Stagecraft, the review
stage's `mode: dispatch` already sends the review to a fresh agent, with its
prompt and result files written by the engine. Neither a new review extension
nor a follow-up issue is warranted.
