/**
 * Tests for the build result contract, puddleworks.dev/build-result/v2.
 *
 * Run with:
 *   ~/.swamp/deno/deno test --allow-read extensions/contracts/build_result_v2_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1.0.19";
import { BUILD_RESULT_V2, parseBuildResultV2 } from "./build_result_v2.ts";

const read = async (file: string) =>
  JSON.parse(
    await Deno.readTextFile(
      new URL(`../../docs/contracts/${file}`, import.meta.url),
    ),
  );
const EXAMPLE = await read("build-result.v2.example.json");

function problemsOf(value: unknown): string[] {
  const result = parseBuildResultV2(value);
  return result.ok ? [] : result.problems;
}

Deno.test("build-result v2: the documented example parses, with its recipe", () => {
  const result = parseBuildResultV2(EXAMPLE);
  assertEquals(result.ok ? [] : result.problems, []);
  if (result.ok) {
    assertEquals(result.result.apiVersion, BUILD_RESULT_V2);
    assertEquals(result.result.recipe?.empty, "No notes need a request.");
  }
});

Deno.test("build-result v2: a v1 result is refused by its apiVersion", async () => {
  const problems = problemsOf(await read("build-result.v1.example.json"));
  assertEquals(problems, [`apiVersion must be "${BUILD_RESULT_V2}".`]);
});

Deno.test("build-result v2: an example's router or recipeId is not part of it", () => {
  const parsed = parseBuildResultV2({
    ...EXAMPLE,
    examples: [{
      phrase: "x",
      passed: true,
      recipeId: "r",
      router: { version: "1" },
    }],
  });
  assertEquals(parsed.ok ? parsed.result.examples : parsed.problems, [
    { phrase: "x", passed: true },
  ]);
});

Deno.test("build-result v2: the recipe is optional until there is one", () => {
  const { recipe: _r, ...rest } = EXAMPLE;
  assertEquals(problemsOf(rest), []);
});

Deno.test("build-result v2: a recipe needs an id, a phrase and an empty answer that isn't blank", () => {
  const recipe = EXAMPLE.recipe;
  for (
    const [where, bad] of [
      ["recipe.empty", { ...recipe, empty: "" }],
      ["recipe.empty", { ...recipe, empty: "   " }],
      ["recipe.empty", { id: recipe.id, phrases: recipe.phrases }],
      ["recipe.phrases", { ...recipe, phrases: [] }],
      ["recipe.phrases.0", { ...recipe, phrases: [" "] }],
      ["recipe.id", { ...recipe, id: "" }],
      ["recipe.id", { ...recipe, id: "r".repeat(201) }],
    ] as const
  ) {
    const problems = problemsOf({ ...EXAMPLE, recipe: bad });
    assertEquals(problems.length, 1, JSON.stringify(bad).slice(0, 60));
    assertStringIncludes(problems[0], where);
  }
});

Deno.test("build-result v2: the contract doc names the recipe and who tests through the router", async () => {
  const doc = (await Deno.readTextFile(
    new URL("../../docs/contracts/build-result-v2.md", import.meta.url),
  )).replace(/\s+/g, " ");
  for (const field of ["`recipe.id`", "`recipe.phrases`", "`recipe.empty`"]) {
    assertStringIncludes(doc, field);
  }
  assertStringIncludes(doc, "outcome owner");
});
