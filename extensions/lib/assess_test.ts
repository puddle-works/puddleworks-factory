/**
 * Tests for the reuse check: which verdict the candidates lead to.
 *
 * Run with:
 *   ~/.swamp/deno/deno test -A extensions/lib/assess_test.ts
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1.0.19";
import { assess, type Candidate, ownerOf } from "./assess.ts";

const ALL = {
  wholeJob: true,
  readOnly: true,
  inputs: true,
  settings: true,
  output: true,
};

const candidate = (
  extension: string,
  checks: Partial<typeof ALL> = {},
): Candidate => ({
  extension,
  type: `${extension}/model`,
  method: "list",
  checks: { ...ALL, ...checks },
  note: "",
});

Deno.test("assess: ours by collective, not by a name that starts the same", () => {
  assertEquals(ownerOf("@puddleworks/recipes"), "ours");
  assertEquals(ownerOf("@mesgme/puddleworks-capture"), "ours");
  assertEquals(ownerOf("@puddleworksx/recipes"), "external");
  assertEquals(ownerOf("@webframp/github"), "external");
});

Deno.test("assess: no candidate, or none that fits every check, means build it", () => {
  assertEquals(assess([], "packaged_script").verdict, "build-functionality");
  const a = assess(
    [candidate("@webframp/github", { output: false })],
    "packaged_script",
  );
  assertEquals(a.verdict, "build-functionality");
  assertEquals(a.chosen, null);
  assertEquals(a.candidates[0].failed, ["output"]);
  assertEquals(a.candidates[0].fits, false);
});

Deno.test("assess: our own exact fit wins over an external one listed first", () => {
  const a = assess(
    [candidate("@webframp/github"), candidate("@puddleworks/notes")],
    "packaged_script",
  );
  assertEquals(a.verdict, "recipe-in-our-extension");
  assertEquals(a.chosen?.extension, "@puddleworks/notes");
});

Deno.test("assess: an external exact fit is a recipe in the external pack", () => {
  const a = assess([candidate("@webframp/github")], "packaged_script");
  assertEquals(a.verdict, "recipe-in-pack");
  assertEquals(a.candidates[0].owner, "external");
});

Deno.test("assess: a recipe needs a read-only method, a schedule doesn't", () => {
  const writes = [candidate("@webframp/github", { readOnly: false })];
  assertEquals(
    assess(writes, "packaged_script").verdict,
    "build-functionality",
  );
  assertEquals(assess(writes, "scheduled_workflow").verdict, "workflow-app");
  assertEquals(
    assess([candidate("@mesgme/x", { readOnly: false })], "scheduled_workflow")
      .verdict,
    "workflow-in-our-extension",
  );
});
