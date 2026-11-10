# The build result contract: `puddleworks.dev/build-result/v2`

v2 is [v1](build-result.md) with two changes, agreed for factory#78 and
capture#27:

- **The build result carries the recipe it published** (`recipe`), so the tool
  the spec came from can compare the recipe's phrases and empty answer with the
  agreed spec, exactly.
- **Router evidence is no longer in the build result.** v1's
  `examples[].recipeId` and `examples[].router` are gone. Whether a phrase is
  answered through puddlerouter is tested by the request's outcome owner, on
  their own desk, and recorded where the request lives (in Capture,
  `record_router_test`). A builder doesn't report it.

Everything else is as in v1, with `apiVersion` set to
`puddleworks.dev/build-result/v2`. `examples[].passed` is the builder's own
check, as readiness or the builder found it.

- Schema and parser:
  [`extensions/contracts/build_result_v2.ts`](../../extensions/contracts/build_result_v2.ts)
- Example: [`build-result.v2.example.json`](build-result.v2.example.json)

## `recipe`

Optional: the first results of a build have no published recipe yet. A reader
that releases a request needs it.

| Field            | Required | Meaning                                                                                     |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `recipe.id`      | yes      | The `id` in the recipe's `puddlerouterRecipe` tag. 1 to 200 characters                      |
| `recipe.phrases` | yes      | The agreed phrases the recipe answers, each exactly as in the spec. 1 to 50, of 500 at most |
| `recipe.empty`   | yes      | The tag's `empty`: what the recipe answers when there is nothing to show. Never blank       |

A reader compares them as plain strings, with no case folding: `recipe.phrases`
must hold every phrase of the agreed recipe (it may hold more), and
`recipe.empty` must equal the agreed `whenEmpty`. A blank empty answer is
refused, so a recipe with nothing to say when it finds nothing can't be
reported, and the agreed spec must say what that answer is.

## Moving from v1

Writers emit v2 once every reader accepts it, and readers accept v1 and v2 until
every writer has moved. A v1 result carries no `recipe`, so a reader that needs
one can't release on it. Capture reads v2 from `@puddleworks/capture`
2026.11.10.1, and Factory's `result` writes v2 from then on.

## How Factory fills in `recipe`

The `@puddleworks/puddleworks-factory-result` workflow adds `recipe` only to a
published result (`publishedVersion` given). It reads the recipe workflow the
draft wrote, in the checkout, and copies its tag's `id` and `empty`; `phrases`
are the agreed phrases the latest readiness check (or the examples passed in)
found answered. It leaves `recipe` out, and logs why, when there is no recipe
file, the tag has no `empty`, or no phrase was found answered. Readiness blocks
a recipe whose tag has no `empty`.
