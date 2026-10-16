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

## Development

```bash
~/.swamp/deno/deno fmt --check
~/.swamp/deno/deno test -A --permit-no-files
```
