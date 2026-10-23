# The app spec contract: `puddleworks.dev/app-spec/v1`

The app spec is what Factory builds from. Anything can write one: a person or
another tool can write it by hand, and Factory prefills one from an agreed
[outcome spec](outcome-spec.md) exported by puddleworks-capture. (Capture used
to export app specs; since its ADR-002 it exports only outcome specs.) Factory
reads no other app's data, only these shapes
([ADR-001](../adr/ADR-001-three-separate-apps.md)).

- Schema and parser:
  [`extensions/contracts/app_spec_v1.ts`](../../extensions/contracts/app_spec_v1.ts)
- Example: [`app-spec.v1.example.json`](app-spec.v1.example.json)

This is Factory's copy. Every Puddleworks app that reads or writes the spec
keeps its own copy and tests against the same example file.

## Where a spec can come from

The `@mesgme/puddleworks-factory-build` workflow takes one `spec` input:

| `spec` starts with | Read as                                    |
| ------------------ | ------------------------------------------ |
| `{`                | Inline JSON                                |
| `https://`         | Fetched; JSON or YAML                      |
| `http://`          | Refused: specs are only fetched over HTTPS |
| anything else      | A file path; JSON or YAML                  |

## Shape

| Field                    | Required | Meaning                                                                                                                                          |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiVersion`             | yes      | Always `puddleworks.dev/app-spec/v1`                                                                                                             |
| `kind`                   | yes      | Always `AppSpec`                                                                                                                                 |
| `name`                   | yes      | Slug (lowercase letters, digits, hyphens). Becomes the app name, the extension type suffix and the model instance name (`<name>-model`)          |
| `title`                  | yes      | One line a person reads                                                                                                                          |
| `specification`          | yes      | Purpose, typed inputs, output, out of scope, settings, who recorded it and when                                                                  |
| `delivery.method`        | yes      | One of `workflow_form`, `packaged_script`, `scheduled_workflow`, `external_app`, `manual_process`. Only the first three have a workflow to build |
| `delivery.entryPointRef` | no       | Workflow name, or `<scope>/<slug>`. Defaults to `name`                                                                                           |
| `reusabilityNote`        | no       | Why the result is reusable beyond the one case that asked for it                                                                                 |
| `source`                 | no       | Where the spec was agreed: `url` (http or https), and optionally the agreed `version` and `specHash`                                             |

Each input is either `required: true` with no default, or `required: false` with
a default of its own type. Input and setting names are unique. `parseAppSpec`
checks these rules as well as the shape and returns each broken rule as a
sentence.

When a spec has a `source`, the build links back to it: the drafted app's
`CLAUDE.md` and `README.md` say "Spec: [where it was agreed](url), version N,
hash `…`", the draft resource records it, and the build result carries it.
`http://` is allowed in `source.url` because Capture runs locally; it is only a
link and is never fetched.

## Changing the contract

- Adding an **optional** field is a v1 change. Readers must ignore fields they
  do not know.
- Renaming, removing or tightening a field, or adding a required one, is a new
  version (`app-spec/v2`). Writers then emit v2 and readers accept both until
  every reader has moved. Each app's copy changes in its own PR.
