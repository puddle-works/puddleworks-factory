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
together); the latest one wins. `repository` defaults to the one the draft was
built with; pass `--input repository=<url>` only to record another.

```bash
swamp workflow run @puddleworks/puddleworks-factory-result \
  --input name=obsidian-puddle-scanner \
  --input buildRef=draft/obsidian-puddle-scanner \
  --input pullRequest=https://github.com/example/obsidian-puddle-scanner/pull/42 \
  --input out=$HOME/obsidian-puddle-scanner.build-result.json
```

Once the build has been checked against the recipe in the agreed spec, pass the
outcomes as well. Pass them on every later run too, because each run replaces
the last:

```bash
swamp workflow run @puddleworks/puddleworks-factory-result \
  --input name=obsidian-puddle-scanner \
  --input buildRef=draft/obsidian-puddle-scanner \
  --input 'examples:json=[{"phrase":"which notes need a request","passed":true}]'
```

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
| `buildRef`      | yes      | Branch or commit the build is on                                                                |
| `pullRequest`   | no       | `https://` URL of the pull request that proposes the build, once there is one                   |
| `published`     | no       | What was pushed to the registry, once it is: `version` and `visibility` (`public` or `private`) |
| `source`        | no       | The app spec's `source`, when it had one: where the spec was agreed                             |
| `examples`      | no       | One entry per example in the agreed spec's recipe, once the build has been checked against them |
| `builtAt`       | yes      | ISO 8601 timestamp of when the result was written                                               |

Each entry in `examples`:

| Field               | Required | Meaning                                                                         |
| ------------------- | -------- | ------------------------------------------------------------------------------- |
| `examples[].phrase` | yes      | The example's phrase, exactly as in the spec. 1 to 500 characters               |
| `examples[].passed` | yes      | Whether the build answers that phrase as the example says                       |
| `examples[].detail` | no       | What was seen, in plain words, especially when it failed. Up to 2000 characters |

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
