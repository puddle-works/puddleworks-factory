# ADR-001: Puddleworks is three separate swamp applications

## Status: Accepted

Recorded identically in `puddleworks-capture`, `puddleworks-factory` and
`puddleworks-distribution`. Epic: puddle-works/puddleworks#207.

## Context

Puddleworks did three jobs in one swamp extension, `@mesgme/puddleworks`:
capturing what someone wants, building a swamp extension from it, and putting
that extension in front of people. The jobs were coupled through shared imports,
workflow steps that read another job's swamp data, and instance names derived
from the request. None of them could be used, replaced or released without the
others.

A modular monolith, meaning one package with capability folders and an
import-boundary test, was considered and rejected. It keeps one release and one
manifest, so no single job can be swapped out.

## Decision

Three separate swamp applications, each in its own repository with its own
manifest, models, workflows, releases and CI:

| Repository                 | Package                            | Job                                                                                | Takes in                                                            | Puts out                                      |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `puddleworks-capture`      | `@mesgme/puddleworks-capture`      | Capture requirements: take a request, discuss it, agree the outcome                | a request                                                           | an `app-spec/v1` file                         |
| `puddleworks-factory`      | `@mesgme/puddleworks-factory`      | Build, test and validate a swamp extension from a spec that can come from anywhere | `app-spec/v1` (path, URL or inline)                                 | the extension's files and a `build-result/v1` |
| `puddleworks-distribution` | `@mesgme/puddleworks-distribution` | Deploy any swamp extension, whoever built it                                       | an extension name and version, plus an optional `app-definition/v1` | a running app on swamp serve or locally       |

Rules:

- **No shared code.** No repository imports from another. They meet only through
  versioned file contracts: a document, a JSON Schema and an example each. Every
  repository keeps its own copy and tests against the same examples.
- **No reads of another app's data.** No `data.latest(...)` across apps and no
  instance names that assume another app made them.
- **Each runs alone.** Capture exports a spec with neither of the others
  installed. Factory builds from a hand-written spec. Distribution deploys an
  extension that Factory never built.
- **The UI is split.** Code is duplicated where needed, never shared.
- Discovery of existing extensions is swamp's registry
  (`swamp extension search`). None of the three builds its own.

## Consequences

**Good:**

- Any one app can be replaced, e.g. a different factory, without touching the
  others
- Each app releases on its own cadence
- The contracts become the explicit, tested interface

**Trade-offs:**

- Three repositories, manifests and CI pipelines to maintain
- Contract schemas are copied, so a contract change means one PR per repository
- Duplicated UI code (auth, layout) can drift
- Moving existing request data to the renamed Capture types needs a checked
  migration
