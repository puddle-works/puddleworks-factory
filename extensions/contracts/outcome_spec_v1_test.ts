/**
 * Tests for Factory's copy of the outcome spec contract,
 * puddleworks.dev/outcome-spec/v1.
 *
 * Run with:
 *   ~/.swamp/deno/deno test --allow-read extensions/contracts/outcome_spec_v1_test.ts
 *
 * @module
 */
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { OUTCOME_SPEC_V1, parseOutcomeSpec } from "./outcome_spec_v1.ts";

/** Capture's example, copied as it is. */
const EXAMPLE = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../docs/contracts/outcome-spec.v1.example.json",
      import.meta.url,
    ),
  ),
);

function problemsOf(value: unknown): string[] {
  const result = parseOutcomeSpec(value);
  return result.ok ? [] : result.problems;
}

Deno.test("outcome-spec: Capture's example parses", () => {
  const result = parseOutcomeSpec(EXAMPLE);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.spec.format, OUTCOME_SPEC_V1);
    assertEquals(result.spec.specification.version, 1);
    assertEquals(result.spec.specification.acceptanceCriteria.length, 3);
  }
});

Deno.test("outcome-spec: another format is refused by name", () => {
  const problems = problemsOf({
    ...EXAMPLE,
    format: "puddleworks.dev/outcome-spec/v2",
  });
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], OUTCOME_SPEC_V1);
});

Deno.test("outcome-spec: an app spec is refused as not an outcome spec", () => {
  const problems = problemsOf({
    apiVersion: "puddleworks.dev/app-spec/v1",
    kind: "AppSpec",
  });
  assertStringIncludes(problems.join(" "), OUTCOME_SPEC_V1);
});

Deno.test("outcome-spec: the request link is required", () => {
  const spec = structuredClone(EXAMPLE);
  delete spec.request.url;
  const problems = problemsOf(spec);
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], "request.url");
});

Deno.test("outcome-spec: the agreed version and hash are required", () => {
  const spec = structuredClone(EXAMPLE);
  delete spec.specification.version;
  delete spec.agreement.specHash;
  const problems = problemsOf(spec);
  assertEquals(problems.length, 2);
  assertStringIncludes(problems.join(" "), "specification.version");
  assertStringIncludes(problems.join(" "), "agreement.specHash");
});

Deno.test("outcome-spec: a v1 reader ignores fields it does not know", () => {
  const result = parseOutcomeSpec({ ...EXAMPLE, priority: "high" });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals("priority" in result.spec, false);
});
