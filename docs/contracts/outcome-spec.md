# The outcome spec contract: `puddleworks.dev/outcome-spec/v1`

An outcome spec is what puddleworks-capture exports once a request's
specification is agreed (ADR-002 in puddleworks-capture). It says what success
looks like and who agreed it. It does not say how to build it: it has no app
name, typed inputs, settings or delivery method. Factory reads it to prefill an
[app spec](app-spec.md), and the builder decides the rest.

- Schema and parser:
  [`extensions/contracts/outcome_spec_v1.ts`](../../extensions/contracts/outcome_spec_v1.ts)
- Example, copied from Capture as it is:
  [`outcome-spec.v1.example.json`](outcome-spec.v1.example.json)

This is Factory's copy. Capture writes the spec and keeps its own copy; both
test against the same example file. Factory only reads it, so its copy checks
less than Capture's does.

## How Factory uses one

The `@puddleworks/puddleworks-factory-prefill` workflow reads an outcome spec (a
file path, an `https://` URL or inline JSON, as for `spec` in
[app-spec.md](app-spec.md#where-a-spec-can-come-from)) and writes a starter app
spec to `out`:

```bash
swamp workflow run @puddleworks/puddleworks-factory-prefill \
  --input outcomeSpec=$HOME/Downloads/weekly-stock-count.outcome-spec.json \
  --input out=$HOME/weekly-stock-count.app-spec.json
```

It refuses to replace an existing `out`, which may hold the builder's edits,
unless you pass `--input overwrite=true`. It records a `prefill` resource
(`prefill-<name>`) listing what is left to decide (`toDecide`) and what to sort
out first (`warnings`: open questions, no acceptance criteria).

| App spec field             | From the outcome spec                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `name`                     | Suggested: `request.title` as a slug of at most 40 characters     |
| `title`                    | `request.title`                                                   |
| `specification.purpose`    | `specification.desiredOutcome`; the builder makes it one sentence |
| `specification.outOfScope` | `specification.scope.out`                                         |
| `specification.recordedBy` | `agreement.agreedBy.email`                                        |
| `specification.recordedAt` | `agreement.agreedAt`                                              |
| `source`                   | `request.url`, `specification.version` and `agreement.specHash`   |
| `specification.inputs`     | Left empty for the builder                                        |
| `specification.output`     | Left blank for the builder                                        |
| `specification.settings`   | Left empty for the builder                                        |
| `delivery.method`          | Left blank for the builder                                        |

The starter is not a valid app spec until the builder fills in the blanks, so it
cannot be built by mistake. Scope in, constraints, assumptions and acceptance
criteria have no place in an app spec. The `factory-build` skill keeps the
outcome spec beside the app spec, in `puddles/<name>/spec/` in the app repo, and
the build plan reads them there.

## Shape

| Field                   | Meaning                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `format`                | Always `puddleworks.dev/outcome-spec/v1`                                                                                         |
| `request`               | `id`, `title`, `initialDescription`, `currentProcess`, and `url`                                                                 |
| `request.url`           | The request's page in Capture, where it was discussed and agreed                                                                 |
| `specification.version` | Which agreed version this is; a positive whole number                                                                            |
| `specification`         | `problemStatement`, `desiredOutcome`, `scope.in`, `scope.out`, `constraints`, `assumptions`, `acceptanceCriteria` (`id`, `text`) |
| `agreement`             | `agreedBy` (`name`, `email`), `agreedAt`, and `specHash`                                                                         |
| `participants`          | `name`, `email` and `role` of everyone involved                                                                                  |
| `openQuestions`         | `question`, `askedBy`, `askedAt`; empty when nothing is open                                                                     |
| `exportedAt`            | When the file was exported                                                                                                       |

Every field is required. A spec with another `format`, including an app spec, is
refused by name.

## Changing the contract

Capture owns this contract. Adding an **optional** field is a v1 change, and
Factory ignores fields it does not know. Anything else is `outcome-spec/v2`, and
Factory's copy changes in its own PR.
