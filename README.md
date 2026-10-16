# puddleworks-factory

Builds, tests and validates a swamp extension from a spec that can come from
anywhere, not only from Capture.

One of three separate Puddleworks swamp applications: Capture, Factory and
Distribution. Each runs alone and can be swapped out. They share no code, only
versioned file contracts. See [ADR-001](docs/adr/ADR-001-three-separate-apps.md)
and the epic puddle-works/puddleworks#207.

| Takes in                                               | Puts out                                      |
| ------------------------------------------------------ | --------------------------------------------- |
| `app-spec/v1` from a path, an https URL or inline JSON | the extension's files and a `build-result/v1` |

The build result contract is in
[docs/contracts/build-result.md](docs/contracts/build-result.md).

The spec contract is in
[docs/contracts/app-spec.md](docs/contracts/app-spec.md), with an
[example](docs/contracts/app-spec.v1.example.json).

## What is in the package

| Kind     | Name                                 | What it does                                                                            |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Model    | `@mesgme/puddleworks-factory/draft`  | `render` reads a spec and writes the extension, its tests, a workflow and the app docs  |
| Workflow | `@mesgme/puddleworks-factory-build`  | Runs `render` on the `puddleworks-factory` instance                                     |
| Workflow | `@mesgme/puddleworks-factory-result` | Runs `result`: writes a `build-result/v1` for the last draft of a spec                  |
| Skill    | `factory-build`                      | Drives a build end to end: branch in the app repo, generate, commit, write a build plan |

## Use

Install the package and create the model instance once:

```bash
swamp extension pull @mesgme/puddleworks-factory
swamp model create @mesgme/puddleworks-factory/draft puddleworks-factory
```

Build from a spec on disk, at an https URL, or inline:

```bash
swamp workflow run @mesgme/puddleworks-factory-build \
  --input spec=docs/contracts/app-spec.v1.example.json \
  --input targetDir=$HOME/dev/puddleworks-apps-draft-obsidian-puddle-scanner

swamp workflow run @mesgme/puddleworks-factory-build \
  --input spec=https://example.com/specs/scanner.json \
  --input targetDir=$HOME/dev/puddleworks-apps-draft-obsidian-puddle-scanner

swamp workflow run @mesgme/puddleworks-factory-build \
  --input "spec=$(cat spec.json)" \
  --input targetDir=$HOME/dev/puddleworks-apps-draft-obsidian-puddle-scanner
```

`targetDir` must be an app repo checkout with an `extensions/models/` directory.
A spec that breaks the contract writes nothing and lists every broken rule.
Existing files are kept unless you pass `--input overwrite=true`.
`--input visibility=private` keeps the drafted package off the public registry.

Once the draft is pushed, write the build result. Add `pullRequest` once the
pull request is open:

```bash
swamp workflow run @mesgme/puddleworks-factory-result \
  --input name=obsidian-puddle-scanner \
  --input repository=https://github.com/puddle-works/puddleworks-apps \
  --input buildRef=draft/obsidian-puddle-scanner \
  --input out=$HOME/obsidian-puddle-scanner.build-result.json
```

## Development

```bash
~/.swamp/deno/deno fmt --check
~/.swamp/deno/deno test -A --permit-no-files
swamp extension quality manifest.yaml
```
