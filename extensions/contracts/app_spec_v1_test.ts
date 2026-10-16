/**
 * Tests for the portable app spec contract, puddleworks.dev/app-spec/v1.
 *
 * Run with:
 *   ~/.swamp/deno/deno test --allow-read extensions/contracts/app_spec_v1_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { APP_SPEC_V1, parseAppSpec } from "./app_spec_v1.ts";

const EXAMPLE = JSON.parse(
  await Deno.readTextFile(
    new URL("../../docs/contracts/app-spec.v1.example.json", import.meta.url),
  ),
);

function problemsOf(value: unknown): string[] {
  const result = parseAppSpec(value);
  return result.ok ? [] : result.problems;
}

Deno.test("app-spec: the documented example parses", () => {
  const result = parseAppSpec(EXAMPLE);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.spec.apiVersion, APP_SPEC_V1);
    assertEquals(result.spec.name, "obsidian-puddle-scanner");
  }
});

Deno.test("app-spec: another apiVersion is refused by name", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    apiVersion: "puddleworks.dev/app-spec/v2",
  });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "apiVersion");
  assertStringIncludes(problems[0], APP_SPEC_V1);
});

Deno.test("app-spec: the name must be a slug", () => {
  const problems = problemsOf({ ...EXAMPLE, name: "Obsidian Scanner" });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "name");
});

Deno.test("app-spec: specification rules the schema cannot express are checked", () => {
  const spec = structuredClone(EXAMPLE);
  delete spec.specification.inputs[0].default;
  const problems = problemsOf(spec);
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "folder");
});

Deno.test("app-spec: a v1 reader ignores fields it does not know", () => {
  const result = parseAppSpec({ ...EXAMPLE, factory: "swamp-start" });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals("factory" in result.spec, false);
});
