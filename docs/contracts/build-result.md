# The build result contract: `puddleworks.dev/build-result/v1`

A build result says what a build produced and where it is. Factory writes one
after a build. Anything can read it as it is: a person, or the tool the spec
came from, to record it against the request. Any factory may write one, not only
this one.

- Schema and parser:
  [`extensions/contracts/build_result_v1.ts`](../../extensions/contracts/build_result_v1.ts)
- Example: [`build-result.v1.example.json`](build-result.v1.example.json)

This is Factory's copy. Any tool that reads or writes the build result can test
against the same example file.

## How Factory writes one

The `@puddleworks/puddleworks-factory-result` workflow builds the result from
its inputs and the last draft that `@puddleworks/puddleworks-factory-build`
rendered for the same `name`. It records the result as a `buildResult` resource
(`build-result-<name>`) and, with `out`, writes it to a JSON file. Run it after
the draft branch is pushed, again once the pull request is open, and again once
the extension is published (`publishedVersion` and `publishedVisibility`, always
together); the latest one wins. Until it is published, `buildRef` is the draft
branch. Once it is, `buildRef` is the commit it was published from, because the
branch can move after the publish, or go when the pull request is merged.
`repository` defaults to the one the draft was built with; pass
`--input repository=<url>` only to record another.

```bash
swamp workflow run @puddleworks/puddleworks-factory-result \
  --input name=obsidian-puddle-scanner \
  --input buildRef=draft/obsidian-puddle-scanner \
  --input pullRequest=https://github.com/example/obsidian-puddle-scanner/pull/42 \
  --input out=$HOME/obsidian-puddle-scanner.build-result.json
```

When the spec has a recipe, `examples` comes from the latest readiness check,
which sends each phrase through the recipe engine, as long as that check came
after the latest render. That check runs the app only if its manifest says
`effects-read`, and then only to time it: it says a phrase reaches the app with
inputs it takes, not that the answer is right. So each passed example's `detail`
says what was checked: that the app was not run, or, for a phrase it timed, how
long the app took and that its answer was not checked. If you have checked more
than that, pass your own outcomes instead, with a `detail` that says what you
saw. Pass them on every later run too, because each run replaces the last:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result \
  --input name=obsidian-puddle-scanner \
  --input buildRef=draft/obsidian-puddle-scanner \
  --input 'examples:json=[{"phrase":"which notes need a request","passed":true,"detail":"Ran it on my vault; it listed the three notes I expected."}]'
```

## Recording it against the request

Factory stops at the file. To move a Capture request on, the builder records the
file there with Capture's `record_build_result` method; Factory imports and
calls nothing of Capture's (ADR-001). Record the first result, written when the
draft is pushed, so the request shows Building, and the last, once the extension
is published.

Capture takes a result only when its `source.url` is a request page and its
`source.version` and `source.specHash` are the agreed version's. A build from a
hand-written app spec has no `source`, so it can't be recorded in Capture. That
is by design: there is no agreed request to record it against.

## Shape

| Field           | Required | Meaning                                                                                         |
| --------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `apiVersion`    | yes      | Always `puddleworks.dev/build-result/v1`                                                        |
| `kind`          | yes      | Always `BuildResult`                                                                            |
| `name`          | yes      | The app spec's `name`: which spec was built. A slug                                             |
| `extension`     | yes      | Package name of the built extension, `@<scope>/<name>`                                          |
| `entryPointRef` | yes      | The workflow to run the app with, `@<scope>/<slug>`                                             |
| `repository`    | yes      | `https://` URL of the repository the build was written to                                       |
| `path`          | no       | Where in the repository the app's manifest is, if not at the root. Relative                     |
| `buildRef`      | yes      | Branch or commit the build is on; the commit once it is published                               |
| `pullRequest`   | no       | `https://` URL of the pull request that proposes the build, once there is one                   |
| `published`     | no       | What was pushed to the registry, once it is: `version` and `visibility` (`public` or `private`) |
| `source`        | no       | The app spec's `source`, when it had one: where the spec was agreed                             |
| `examples`      | no       | One entry per example in the agreed spec's recipe, once the build has been checked against them |
| `builtAt`       | yes      | ISO 8601 timestamp of when the result was written                                               |

A private publish is still published: `published` says the version is in the
registry, and `visibility` says who can see it.

Each entry in `examples`:

| Field                 | Required | Meaning                                                                                                 |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `examples[].phrase`   | yes      | The example's phrase, exactly as in the spec. 1 to 500 characters                                       |
| `examples[].passed`   | yes      | Whether the build answers that phrase as the example says                                               |
| `examples[].detail`   | no       | What was seen, in plain words: why it failed, or what was checked when it passed. Up to 2000 characters |
| `examples[].recipeId` | no       | The `id` of the puddlerouter recipe that answered the phrase. 1 to 200 characters                       |
| `examples[].router`   | no       | How the phrase went through puddlerouter, once it has been tested there (below)                         |

`router` is the evidence that a recipe answered the phrase through the router,
not Claude. It has:

| Field      | Required | Meaning                                                                                        |
| ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| `testedAt` | yes      | ISO 8601 timestamp of when the phrase was sent through the router                              |
| `version`  | yes      | The extension version installed in the desk at the time                                        |
| `outcome`  | yes      | `answered` (a recipe that only reads answered), or `answered-after-yes` (it asked, then ran)   |
| `source`   | yes      | The request the recipe answers, as the router's `match` returned it: `url`, optional `version` |

An example the router sent to Claude, or that no recipe answered, has no
`router`, and is not passed. Every example of one request names the same
`recipeId`, as the agreed spec has one recipe. A reader that releases a request
on this can check that `router.version` is the published version.
`router.source` names the request the recipe was written for: usually this one,
but another request's when the build reuses a recipe. `testedAt` is for people
to read: it comes from another machine's clock, so don't compare it with
`builtAt`.

There are at most 50 entries. A reader that decides whether a request is done
matches each `phrase` against the agreed spec. A missing example counts as not
passed, the same as a failed one, so a result with no `examples` says nothing
was checked. Factory leaves an empty list out.

`parseBuildResult` checks the shape and returns each broken rule as a sentence.

## Changing the contract

- Adding an **optional** field is a v1 change. Readers must ignore fields they
  do not know.
- Renaming, removing or tightening a field, or adding a required one, is a new
  version (`build-result/v2`). Writers then emit v2 and readers accept both
  until every reader has moved. Each app's copy changes in its own PR.
